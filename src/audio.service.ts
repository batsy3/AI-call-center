import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAI } from 'openai';
import WebSocket from 'ws';

@Injectable()
export class AudioService {
  private openAi: OpenAI;
  private messageHistory: Map<
    string,
    Array<{
      role: 'user' | 'assistant' | 'system';
      content: string;
    }>
  > = new Map();
  private audioBuffers: Map<string, Buffer[]> = new Map();
  private processingLocks: Map<string, boolean> = new Map();
  private lastAudioTime: Map<string, number> = new Map();
  private activeChecks: Map<string, boolean> = new Map();
  private readonly logger = new Logger(AudioService.name);
  private readonly SILENCE_THRESHOLD = 1000;
  constructor(private ConfigService: ConfigService) {
    this.openAi = new OpenAI({
      apiKey: this.ConfigService.get('openai.apiKey'),
      // apiKey:
      //   '',
    });
  }

  async handleAudioStream(socket: WebSocket, callSid: string) {
    this.logger.log(`Initializing audio stream for call ${callSid}`);
    this.messageHistory.set(callSid, [
      {
        role: 'system',
        content:
          'You are a helpful AI assistant engaging in a phone conversation. Keep responses concise and natural.',
      },
      {
        role: 'assistant',
        content: 'Welcome, how may I help you today?', // Initial greeting
      },
    ]);
    
    this.audioBuffers.set(callSid, []);
    this.processingLocks.set(callSid, false);
    this.lastAudioTime.set(callSid, Date.now());
    socket.onmessage = async (data) => {
      try {
        const message = JSON.parse(data.data.toString());

        if (message.event === 'start') {
          this.logger.log('Media stream started');
        }

        if (message.event === 'media' && message.media.track === 'inbound') {
          this.logger.log('Received audio chunk, processing...');
          this.handleAudioChunk(socket, callSid, message.media.payload);
        }

        if (message.event === 'stop') {
          this.logger.log('Media stream stopped');
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    };
    socket.onerror = (error) => {
      this.logger.error(`WebSocket error for call ${callSid}:`, error);
      socket.close();
      this.cleanup(callSid);
    };
    socket.onclose = () => {
      this.logger.log(`Cleaning up call ${callSid}`);
      this.messageHistory.delete(callSid);
      this.cleanup(callSid);
    };
  }

  private async handleAudioChunk(
    socket: WebSocket,
    callSid: string,
    audioData: string,
  ) {
    const currentBuffer = this.audioBuffers.get(callSid);
    currentBuffer.push(Buffer.from(audioData, 'base64'));
    this.logger.debug(`pushing to buffer ${callSid}`);
    this.lastAudioTime.set(callSid, Date.now());

    if (!this.processingLocks.get(callSid) && !this.activeChecks.get(callSid)) {
      this.activeChecks.set(callSid, true);
      await this.checkAndProcessAudio(socket, callSid);
    }
  }

  private async checkAndProcessAudio(socket: WebSocket, callSid: string) {
    if (!this.audioBuffers.has(callSid)) {
      this.activeChecks.set(callSid, false);
      return;
    }
    const checkBuffer = async () => {
      const currentTime = Date.now();
      const lastAudioTime = this.lastAudioTime.get(callSid);
      this.logger.debug(`Checking for quiet time ${callSid}`);
      if (currentTime - lastAudioTime >= this.SILENCE_THRESHOLD) {
        if (this.audioBuffers.get(callSid).length > 0) {
          this.processBufferedAudio(socket, callSid);
          this.processingLocks.set(callSid, false);
          this.activeChecks.set(callSid, false);
        }
      } else {
        const timeoutId = setTimeout(() => checkBuffer(), 100);
      }
    };

    await checkBuffer();
  }

  private async processBufferedAudio(socket: WebSocket, callSid: string) {
    if (this.processingLocks.get(callSid)) return;

    try {
      this.processingLocks.set(callSid, true);

      const buffers = this.audioBuffers.get(callSid);
      if (!buffers.length) return;

      const combinedBuffer = Buffer.concat(buffers);
      this.audioBuffers.set(callSid, []); // Clear the buffer

      this.logger.log('Processing combined audio chunk');
      const transcription = await this.transcribeAudio(combinedBuffer);

      if (transcription) {
        const aiResponse = await this.getAIResponse(callSid, transcription);
        const audioResponse = await this.textToSpeech(aiResponse);

        socket.send(
          JSON.stringify({
            event: 'media',
            streamSid: callSid,
            media: {
              track: 'outbound',
              chunk: audioResponse.toString('base64'),
              timestamp: Date.now(),
              payload: audioResponse.toString('base64'),
            },
          }),
        );
      }
    } catch (error) {
      this.logger.error('Error processing buffered audio:', error);
    } finally {
      this.processingLocks.set(callSid, false);
    }
  }

  private cleanup(callSid: string) {
    this.messageHistory.delete(callSid);
    this.audioBuffers.delete(callSid);
    this.processingLocks.delete(callSid);
    this.lastAudioTime.delete(callSid);
    this.activeChecks.delete(callSid);
  }
  private async transcribeAudio(audioBuffer: any): Promise<string> {
    try {
      const audioBlob = Buffer.from(audioBuffer, 'base64');
      this.logger.debug(
        `Processing audio chunk of size: ${audioBlob.length} bytes`,
      );

      const response = await this.openAi.audio.transcriptions.create({
        file: new File([audioBlob], 'audio.wav', {
          type: 'audio/wav',
        }),
        model: 'whisper-1',
      });
      return response.text;
    } catch (error) {
      this.logger.error('Error transcribing audio:', error);
      return null;
    }
  }
  private async getAIResponse(
    callSid: string,
    userMessage: string,
  ): Promise<string> {
    const history = this.messageHistory.get(callSid);
    history.push({ role: 'user', content: userMessage });

    const completion = await this.openAi.chat.completions.create({
      model: 'gpt-4o-mini-realtime-preview-2024-12-17',
      messages: history,
      max_tokens: 150,
    });

    const aiMessage = completion.choices[0].message;
    history.push(aiMessage);

    return aiMessage.content;
  }
  private async textToSpeech(text: string): Promise<Buffer<ArrayBufferLike>> {
    const response = await this.openAi.audio.speech.create({
      model: 'tts-1',
      input: text,
      voice: 'alloy',
    });
    return Buffer.from(await response.arrayBuffer());
  }
}
