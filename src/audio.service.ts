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
  private readonly logger = new Logger(AudioService.name);
  constructor(private ConfigService: ConfigService) {
    this.openAi = new OpenAI({
      // apiKey: this.ConfigService.get('openai.apiKey'),
      apiKey:
        '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',
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
    this.messageHistory.set(callSid, []);

    socket.onmessage = async (data) => {
      try {
        console.log('Received message:', data);
        const message = JSON.parse(data.data.toString());

        if (message.event === 'start') {
          this.logger.log('Media stream started');
        }

        if (message.event === 'media') {
          this.logger.log('Received audio chunk, processing...');
          await this.processAudioChunk(socket, callSid, message.media.payload);
        }

        if (message.event === 'stop') {
          this.logger.log('Media stream stopped');
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
      socket.onerror = (error) => {
        this.logger.error(`WebSocket error for call ${callSid}:`, error);
      };

      socket.onclose = () => {
        this.logger.log(`Cleaning up call ${callSid}`);
        this.messageHistory.delete(callSid);
      };
    };

    socket.close = () => {
      this.messageHistory.delete(callSid);
    };
  }

  private async processAudioChunk(
    socket: WebSocket,
    callSid: string,
    audioData: any,
  ) {
    try {
      this.logger.log('Step 1: Starting audio transcription');
      const transcription = await this.transcribeAudio(audioData);
      this.logger.log(`Transcription result: ${transcription}`);

      if (transcription) {
        this.logger.log('Step 2: Getting AI response');
        const aiResponse = await this.getAIResponse(callSid, transcription);
        this.logger.log(`AI response: ${aiResponse}`);

        this.logger.log('Step 3: Converting response to speech');
        const audioResponse = await this.textToSpeech(aiResponse);
        this.logger.log('Audio response generated successfully');

        this.logger.log('Step 4: Sending audio response back to client');
        socket.send(
          JSON.stringify({
            event: 'media',
            streamSid: callSid,
            media: {
              payload: audioResponse.toString('base64'),
            },
          }),
        );
        this.logger.log('Response sent successfully');
      }
    } catch (error) {
      this.logger.error('Error in processAudioChunk:', error);
    }
  }
  private async transcribeAudio(audioBuffer: any): Promise<string> {
    try {
      const audioBlob = Buffer.from(audioBuffer, 'base64');

      // Log the audio data size to verify we're receiving data
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
