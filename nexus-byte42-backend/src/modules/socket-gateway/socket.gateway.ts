import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import { RedisProvider } from 'src/providers/redis.provider';
import { MessageDto } from '../chat/message/dtos/message-dto';
import { MessageService } from '../chat/message/services/message.service';
import { Types } from 'mongoose';
import { ChatRoomService } from '../chat/chat-room/services/chat-room.service';
import { ParticipantDto } from '../chat/chat-room/dtos/participant.dto';
import { SocketGatewayService } from './services/socket.gateway.service';
import { OnlineUsersDto } from './dtos/online-users.dto';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly chatRoomService: ChatRoomService,
    private readonly messageService: MessageService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisProvider,
    private readonly socketGatewayService: SocketGatewayService,
  ) {}

  @WebSocketServer()
  server: Server;

  async handleConnection(client: any, ...args: any[]) {
    const auth = client.handshake.headers.authorization;
    if (!auth) {
      client.disconnect();
      return;
    }

    const token = auth.split(' ');
    if (!token || token.length <= 1) {
      client.disconnect();
      return;
    }

    const user = this.jwtService.verify(token[1]);
    if (!user) {
      client.disconnect();
      return;
    }
    const onlineUsersDto: OnlineUsersDto = {
      connectionId: client.id,
      email: user.email,
    };
    const onlineUsers = await this.socketGatewayService.addOnlineUser(
      onlineUsersDto,
    );
    this.server.emit('user_connected', onlineUsers);

    console.log('handleConnection-->' + client.id);

    const chatRoom = await this.chatRoomService.createChatRoomIfNotExist();
    if (chatRoom) {
      const participantDto: ParticipantDto = {
        chatRoomId: chatRoom._id,
        participantId: user.sub,
      };
      await this.chatRoomService.addParticipant(participantDto);
    }
  }

  async handleDisconnect(client: any) {
    console.log('handleDisconnect->' + client.id);
    await this.socketGatewayService.removeOnlineUser(client.id);
    this.server.emit('user_disconnected', {
      connectionId: client.id,
    });
  }

  @SubscribeMessage('message')
  async listenForMessages(
    @MessageBody() data: any,
    @ConnectedSocket() client: any,
  ) {
    console.log(data);
    console.log('listenForMessages->' + client.id);

    const chatRoom = await this.chatRoomService.createChatRoomIfNotExist();
    const userId = await this.redis.get(client.id);

    const messageDto: MessageDto = {
      content: data,
      chatRoomId: chatRoom._id,
      senderId: new Types.ObjectId(userId),
    };

    await this.messageService.addMessage(messageDto);
    this.server.sockets.emit('receive_message', messageDto.content);
  }
}
