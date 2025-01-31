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
import recorder from 'node-record-lpcm16';
import speech from '@google-cloud/speech';
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
  private readonly SYSTEM_MESSAGE = `You are a professional and efficient dental clinic virtual receptionist. Your primary responsibilities include:
- Greeting patients warmly and professionally
- Scheduling and managing appointments
- Handling basic insurance and payment inquiries
- Providing directions to the clinic
- Managing urgent dental care requests with appropriate prioritization
- Checking and confirming patient records
- Sending appointment reminders
- Explaining basic clinic policies and procedures

Please follow these guidelines:
- Always maintain HIPAA compliance and patient confidentiality
- Prioritize dental emergencies (severe pain, broken teeth, swelling) for immediate attention
- Collect essential information: patient name, contact details, reason for visit, insurance information
- For new patients, explain registration process and required documentation
- Remind patients about important preparations before appointments (medical history, insurance cards, etc.)
- Keep a professional, caring, and reassuring tone
- If unsure about medical advice, always refer to dental professionals
- For scheduling, verify availability in the system before confirming appointments
- Confirm all appointments by repeating back date, time, and type of visit

Emergency protocol:
- For severe pain, swelling, or trauma, immediately connect to emergency dental care
- Provide basic first-aid guidance for common dental emergencies while arranging care
- Keep emergency contact numbers readily available

Working hours:
- Regular hours: Monday-Friday 9:00 AM - 6:00 PM
- Emergency after-hours care available through on-call service`;
  private readonly VOICE = 'alloy';
  private readonly PORT = process.env.PORT || 5050;
  private readonly LOG_EVENT_TYPES = [
    'response.content.done',
    'rate_limits.updated',
    'response.content.part',
    'response.done',
    'input_audio_buffer.committed',
    'input_audio_buffer.speech_stopped',
    'input_audio_buffer.speech_started',
    'session.created',
  ];
  private encoding = 'Encoding of the audio file, e.g. LINEAR16';
  private sampleRateHertz = 16000;
  private languageCode = 'BCP-47 language code, e.g. en-US';

  private readonly MIN_BUFFER_DURATION = 500;
  private readonly MAX_BUFFER_DURATION = 1500;
  private openAiWs: WebSocket;
  private googleClient;
  private audioBuffer: string[] = [];
  private isSpeechActive = false;
  constructor(private readonly ConfigService: ConfigService) {
    this.googleClient = new speech.SpeechClient();
  }
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
        modalities: ['text', 'audio'],
        temperature: 0.8,
      },
    };
    console.log('Sending session update');
    this.openAiWs.send(JSON.stringify(sessionUpdate));
  }
  private async transcribeWithGoogle(audioBuffer: Buffer): Promise<string> {
    const request = {
      config: {
        encoding: 'MULAW',
        sampleRateHertz: 8000,
        languageCode: 'en-US',
        model: 'phone_call',
        useEnhanced: true,
      },
      audio: {
        content: audioBuffer.toString('base64'),
      },
    };

    try {
      const [response] = await this.googleClient.recognize(request);
      const transcription = response.results
        .map((result) => result.alternatives[0].transcript)
        .join('\n');
      return transcription;
    } catch (error) {
      console.error('Error transcribing with Google Speech-to-Text:', error);
      return '';
    }
  }
  handleConnection(connection: WebSocket, request: IncomingMessage) {
    this.openAiWs.on('message', (data) => {
      try {
        const response = JSON.parse(data.toString());
        if (this.LOG_EVENT_TYPES.includes(response.type)) {
          console.log(`openAi Received event: ${response.type}`);
        }
        if (response.response && response.response.status === 'failed') {
          console.error(
            'OpenAI response failed:',
            JSON.stringify(response.response.status_details, null, 2),
          );
        }
        if (response.type === 'session.updated') {
          console.log('Session updated successfully:');
        }
        if (response.type === 'response.content.part' && response.content) {
          console.log('OpenAI Transcription:', response.content);
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
    connection.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        switch (data.event) {
          case 'start':
            this.streamSid = data.start.streamSid;
            console.log('Incoming stream has started', this.streamSid);
            break;
          case 'media':
            const audioBuffer = Buffer.from(data.media.payload, 'base64');
            if (this.openAiWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: data.media.payload,
              };
              this.openAiWs.send(JSON.stringify(audioAppend));
            }
            const googleTranscription =
              await this.transcribeWithGoogle(audioBuffer);
            if (googleTranscription) {
              console.log(
                'Google Speech-to-Text Transcription:',
                googleTranscription,
              );
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
}
