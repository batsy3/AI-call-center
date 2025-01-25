import { Inject, Injectable } from '@nestjs/common';
const twilio = require('twilio');
import { ConfigService } from '@nestjs/config';
import { CallMetadata } from './call.interface';
import { AudioService } from './audio.service';
import { Twilio } from 'twilio';
import WebSocket from 'ws';
const VoiceResponse = require('twilio').twiml
  .VoiceResponse as typeof import('twilio').twiml.VoiceResponse;
@Injectable()
export class AppService {
  private readonly client: Twilio;
  private readonly webUrl: string;

  constructor(
    @Inject('ACTIVE_CALLS')
    private activeCalls: Map<string, CallMetadata>,
    private configService: ConfigService,
    private audioService: AudioService,
  ) {
    this.client = twilio(
      'ACf030769706d9a5c00e2a80f2b4a74d16',
      'b234170961a844b47ac03c4a23918a95',
      {
        lazyLoading: true,
        logLevel: 'debug',
      },
    );
  }

  async initiateCall(to: string) {
    try {
      const response = new VoiceResponse();
      const initialGreeting = 'Welcome, how may I help you today?';
      response.say(initialGreeting);
      const call = await this.client.calls.create({
        to,
        from: this.configService.get('twilio.phoneNumber'),
        //     twiml: ` <Response>
        //      <Say>${initialGreeting}</Say>
        //      <Connect>
        //      </Connect>
        //    </Response>
        //  `,
        twiml: `
          <Response>
            <Say>${initialGreeting}</Say>
            <Connect>
              <Stream name="Outbound Audio Stream" track="inbound_track" url="wss://204c-41-223-116-250.ngrok-free.app/call/intercept">
               <Parameter name="track" value="both" />
              </Stream>
            </Connect>
          </Response>
        `,
        record: true,
      });

      this.activeCalls.set(call.sid, {
        callSid: call.sid,
        from: this.configService.get('twilio.phoneNumber'),
        to,
        status: 'initiated',
        initialGreeting,
      });
      console.log('Stream connected');
      return {
        success: true,
      };
    } catch (error) {
      console.error('Error initiating call:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
  async handleWebSocket(socket: Set<WebSocket>) {
    socket.forEach((ws) => {
      this.activeCalls.forEach((call) => {
        if (call.callSid) {
          this.audioService.handleAudioStream(ws, call.callSid);
        } else {
          ws.close = () => {
            this.activeCalls.delete(call.callSid);
          };
        }
      });
    });
  }
}
