import { Inject, Injectable } from '@nestjs/common';
const twilio = require('twilio');
import { ConfigService } from '@nestjs/config';
import { CallMetadata } from './call.interface';
import { AudioService } from './audio.service';
import { Twilio } from 'twilio';
import WebSocket from 'ws';
import { SpeechClient } from '@google-cloud/speech';
import { readFile } from 'fs';
const VoiceResponse = require('twilio').twiml
  .VoiceResponse as typeof import('twilio').twiml.VoiceResponse;
@Injectable()
export class AppService {
  private readonly client: Twilio;
  private readonly webUrl: string;
  private googleApi;
  private audioBuffer: Buffer;
  constructor(
    @Inject('ACTIVE_CALLS')
    private activeCalls: Map<string, CallMetadata>,
    private configService: ConfigService,
    private audioService: AudioService,
  ) {
    this.client = twilio(
      `${this.configService.get('twilio.accountSid')}`,
      `${this.configService.get('twilio.authToken')}`,
      {
        lazyLoading: true,
        logLevel: 'debug',
      },
    );
    this.googleApi = new SpeechClient();
  }
  async testGoogleApi() {
    readFile('src/audiotest.mp3', async (err, audioBuffer) => {
      this.audioBuffer = audioBuffer;
      if (err) {
        console.error('Error reading the audio file:', err);
        return;
      }
      try {
        const request = {
          config: {
            encoding: 'MP3',
            sampleRateHertz: 16000,
            languageCode: 'en-US',
            audioChannelCount: 1,
            useEnhanced: true,
          },
          audio: {
            content: audioBuffer.toString('base64'),
          },
        };

        const [response] = await this.googleApi.recognize(request);
        const transcription = response.results
          .map((result) => result.alternatives[0].transcript)
          .join('\n');
        console.log('Google Api Transcription...' + transcription);
      } catch (error) {
        console.log('error transcribing', error);
      }
    });
  }
  async initiateCall(to: string) {
    try {
      const response = new VoiceResponse();
      const initialGreeting = 'Welcome, how may I help you today?';
      response.say(initialGreeting);
      const call = await this.client.calls.create({
        to,
        from: this.configService.get('twilio.phoneNumber'),
        twiml: `
          <Response>
            <Say>${initialGreeting}</Say>
            <Connect>
              <Stream name="Outbound Audio Stream" track="inbound_track" url="wss://64a1-41-216-95-226.ngrok-free.app/call/intercept">
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
        call_id: call.sid,
      };
    } catch (error) {
      console.error('Error initiating call:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
