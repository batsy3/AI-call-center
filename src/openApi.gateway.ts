import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import * as WebSocket from 'ws';
import { Server } from 'ws';

// get input from stream or connect stream to this websocket
@WebSocketGateway()
export class OpenApiGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server; // Using socket.io for handling incoming client connections
  private openAiWs: WebSocket;
  constructor(private configService: ConfigService) {
    this.openAiWs = new WebSocket('wss://api.openai.com/v1/real-time-preview', {
      headers: {
        Authorization: `Bearer ${this.configService.get('openai.apiKey')}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    });
  }
  afterInit(server: any) {
    console.log('WebSocket Gateway Initialized');
    console.log(`openApi config : ${this.configService.get('openai.apiKey')}`);

    this.openAiWs.on('message', (data) => {
      console.log('Received message from OpenAI:', data.toString());
      this.server.emit('openai_message', data.toString()); // Emit to all clients connected to this WebSocket server
    });

    this.openAiWs.on('error', (err) => {
      console.error('Error in OpenAI WebSocket connection:', err);
    });

    this.openAiWs.on('close', () => {
      console.log('OpenAI WebSocket connection closed');
    });
  }
  handleConnection() {
    this.openAiWs.onmessage = (event) => {
      console.log('Received message from openAi:', event.data);
      this.server.emit('message', event.data);
    };
  }
  handleDisconnect(client: any) {
    throw new Error('Method not implemented.');
  }
  sendMessageToOpenAI(client: WebSocket, message: string) {
    console.log(`Sending message to OpenAI: ${message}`);
    if (this.openAiWs.readyState === WebSocket.OPEN) {
      this.openAiWs.send(message);
    } else {
      console.error('WebSocket is not open');
    }
  }
}
