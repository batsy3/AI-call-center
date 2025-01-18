import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, WebSocket } from 'ws';
import { AudioService } from './audio.service';
import { IncomingMessage } from 'http';
import { CallMetadata } from './call.interface';
@Injectable()
@WebSocketGateway({
  path: '/call/intercept',
  transports: ['websocket'],
  cors: true,
})
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private wss: Server;

  constructor(
    private readonly AudioService: AudioService,
    @Inject('ACTIVE_CALLS')
    private readonly activeCalls: Map<string, CallMetadata>,
  ) {}
  async handleConnection(client: WebSocket, request: IncomingMessage) {
    if (this.activeCalls.size == 0) { 
      console.log('No active calls');
      client.close(1011, 'No active calls');
      return;
    }
    this.activeCalls.forEach(async (element) => {
      try {
        console.log(
          `New WebSocket connection established for call: ${element.callSid}`,
        );
        client.on('error', (error) => {
          console.error(`WebSocket error for call ${element.callSid}:`, error);
        });

        client.on('close', () => {
          console.log(`WebSocket connection closed for call ${element.callSid}`);
        });
        await this.AudioService.handleAudioStream(client, element.callSid);
      } catch (error) {
        console.error('Failed to initialize voice stream:', error);
        client.close(1011, 'Failed to initialize voice stream');
      }
    });
  }

  handleDisconnect(client: any) {
    console.log('Client disconnected:', client.id);
  }

  afterInit(server: Server) {
    console.log('WebSocket server initialized');
    server.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
  }
}
