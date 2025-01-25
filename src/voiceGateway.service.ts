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
import { ConfigService } from '@nestjs/config';
@Injectable()
@WebSocketGateway({
  path: '/call/intercept',
  transports: ['websocket'],
  cors: true,
})
export class VoiceGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  private wss: Server;
  private streamSid = null;
  private isOpenAiConnected = false;
  private readonly SYSTEM_MESSAGE =
    'You are a helpful and bubbly AI assistant who loves to chat about anything the user is interested about and is prepared to offer them facts. You have a penchant for dad jokes, owl jokes, and rickrolling – subtly. Always stay positive, but work in a joke when appropriate.';
  private readonly VOICE = 'alloy';
  private readonly PORT = process.env.PORT || 5050;
  private readonly LOG_EVENT_TYPES = [
    'response.content.done',
    'rate_limits.updated',
    'response.done',
    'input_audio_buffer.committed',
    'input_audio_buffer.speech_stopped',
    'input_audio_buffer.speech_started',
    'session.created',
  ];
  private readonly MIN_BUFFER_DURATION = 500;
  private readonly MAX_BUFFER_DURATION = 1500;
  private openAiWs: WebSocket;
  private audioBuffer: string[] = [];
  private isSpeechActive = false;
  private speechStartTime: number | null = null;
  constructor(private readonly ConfigService: ConfigService) {}
  async onModuleInit() {
    await this.initializeOpenAiConnection().then(() =>
      console.log('OpenAI connection initialized'),
    );
  }
  private async initializeOpenAiConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.openAiWs = new WebSocket(
          'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17',
          {
            headers: {
              Authorization: `Bearer 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`,
              'OpenAI-Beta': 'realtime=v1',
            },
          },
        );

        const connectionTimeout = setTimeout(() => {
          if (!this.isOpenAiConnected) {
            reject(new Error('OpenAI WebSocket connection timeout'));
            this.openAiWs.close();
          }
        }, 10000);

        this.openAiWs.on('open', () => {
          console.log('Connected to the OpenAI Realtime API');
          this.sendSessionUpdate();
          this.isOpenAiConnected = true;
          clearTimeout(connectionTimeout);
          resolve();
        });

        this.openAiWs.on('error', (error) => {
          console.error('Error in OpenAI WebSocket connection:', error);
          clearTimeout(connectionTimeout);
          reject(error);
        });

        this.openAiWs.on('close', (code, reason) => {
          console.log(
            `Disconnected from the OpenAI Realtime API code code ${code} reason: ${reason}`,
          );
          this.isOpenAiConnected = false;
          setTimeout(() => {
            this.handleOpenAiDisconnect();
          }, 5000);
        });
      } catch (error) {
        reject(error);
      }
    });
  }
  private async handleOpenAiDisconnect() {
    console.log('Attempting to reconnect to OpenAI...');
    try {
      await this.initializeOpenAiConnection();
    } catch (error) {
      console.error('Failed to reconnect to OpenAI:', error);
      // Implement exponential backoff here if needed
    }
  }

  sendSessionUpdate() {
    const sessionUpdate = {
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        input_audio_format: 'g711_ulaw',
        output_audio_format: 'g711_ulaw',
        voice: this.VOICE,
        instructions: this.SYSTEM_MESSAGE,
        modalities: ['text', 'audio'],
        temperature: 0.8,
      },
    };
    console.log('Sending session update');
    this.openAiWs.send(JSON.stringify(sessionUpdate));
  }
  private processAudioStream() {
    this.isSpeechActive = false;
    this.speechStartTime = null;

    const combinedPayload = this.audioBuffer.concat('');
    const audioDuration = this.calculateAudioDuration(combinedPayload);
    console.log(`Audio duration: ${audioDuration}ms`);
    const audioAppendRequest = {
      type: 'input_audio_buffer.append',
      audio: combinedPayload,
    };

    const audioCommitRequest = {
      type: 'input_audio_buffer.commit',
    };

    if (this.openAiWs.readyState === WebSocket.OPEN) {
      console.log(
        'Processing and committing audio stream:',
        audioAppendRequest,
      );
      this.openAiWs.send(JSON.stringify(audioAppendRequest));
      this.openAiWs.send(JSON.stringify(audioCommitRequest));
    }
    this.audioBuffer = [];
  }
  handleConnection(connection: WebSocket, request: IncomingMessage) {
    this.openAiWs.on('message', (data) => {
      console.log(`open ai message: ${data}`);
      try {
        const response = JSON.parse(data.toString());
        if (this.LOG_EVENT_TYPES.includes(response.type)) {
          console.log(`openAi Received event: ${response.type}`, response);
        }
        if (response.response && response.response.status === 'failed') {
          console.error(
            'OpenAI response failed:',
            JSON.stringify(response.response.status_details, null, 2),
          );
        }
        if (response.type === 'session.updated') {
          console.log('Session updated successfully:', response);
        }
        if (response.type === 'response.audio.delta' && response.delta) {
          const audioDelta = {
            event: 'media',
            streamSid: this.streamSid,
            media: {
              payload: Buffer.from(response.delta, 'base64').toString('base64'),
            },
          };
          connection.send(JSON.stringify(audioDelta));
        }
      } catch (error) {
        console.error(
          'Error processing OpenAI message:',
          error,
          'Raw message:',
          data,
        );
      }
    });
    connection.on('open', () => {
      console.log('Client connected:', connection.url);
    });
    // Handle incoming messages from Twilio
    connection.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        switch (data.event) {
          case 'start':
            this.streamSid = data.start.streamSid;
            console.log('Incoming stream has started', this.streamSid);
            break;
          case 'media':
            // const currentTime = Date.now();

            // if (!this.isSpeechActive) {
            //   this.isSpeechActive = true;
            //   this.speechStartTime = currentTime;
            //   this.audioBuffer = [];
            // }

            // this.audioBuffer.push(data.media.payload);
            // const bufferDuration = currentTime - this.speechStartTime;
            // if (
            //   bufferDuration >= this.MIN_BUFFER_DURATION &&
            //   bufferDuration <= this.MAX_BUFFER_DURATION
            // ) {
            // this.processAudioStream();
            // }
            if (this.openAiWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: data.media.payload,
              };
              this.openAiWs.send(JSON.stringify(audioAppend));
            }
            break;
          default:
            console.log('Received non-media event:', data.event);
            break;
        }
      } catch (error) {
        console.error('Error parsing message:', error, 'Message:', message);
      }
    });
    // Handle connection close
    connection.on('close', () => {
      if (this.openAiWs.readyState === WebSocket.OPEN) this.openAiWs.close();
      console.log('Client disconnected.');
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
  private calculateAudioDuration(audioBuffer: string[]): number {
    // Assumptions:
    // - G.711 ulaw format (8kHz sampling rate)
    // - Each sample is 1 byte
    const bytesPerSecond = 8000; // 8kHz * 1 byte per sample
    const totalBytes = audioBuffer.reduce(
      (sum, chunk) => sum + chunk.length,
      0,
    );

    // Calculate duration in milliseconds
    const durationMs = (totalBytes / bytesPerSecond) * 1000;

    return durationMs;
  }
}
