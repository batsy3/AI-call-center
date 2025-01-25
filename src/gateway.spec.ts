import { Test, TestingModule } from '@nestjs/testing';
import { VoiceGateway } from './voiceGateway.service';
import { ConfigService } from '@nestjs/config';
import { Server } from 'ws';
import * as WebSocket from 'ws';
import { IncomingMessage } from 'http';

jest.mock('ws');

describe('VoiceGateway', () => {
  let service: VoiceGateway;
  let mockServer: Server;
  let mockClient: WebSocket;
  let mockOpenAiWs: WebSocket;
  let mockConfigService: ConfigService;

  beforeEach(async () => {
    mockConfigService = {
      get: jest.fn().mockReturnValue('test-api-key'),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceGateway,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<VoiceGateway>(VoiceGateway);
    mockServer = new Server();
    mockClient = new WebSocket('ws://localhost');
    mockOpenAiWs = new WebSocket('ws://openai');

    service['openAiWs'] = mockOpenAiWs;
  });

  it('should handle connection and pass media stream to OpenAI socket', async () => {
    const mockRequest = {} as IncomingMessage;
    const sendSpy = jest.spyOn(mockOpenAiWs, 'send');
    const openSpy = jest
      .spyOn(mockClient, 'on')
      .mockImplementation((event, cb) => {
          if (event === 'open') {
              cb.call(mockClient);
              return mockClient
          }
      });

    await service.handleConnection(mockClient, mockRequest);

    expect(openSpy).toHaveBeenCalledWith('open', expect.any(Function));

    const mediaMessage = JSON.stringify({
      event: 'media',
      media: { payload: 'test-audio' },
    });

    mockClient.emit('message', mediaMessage);

    expect(sendSpy).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: 'test-audio',
      }),
    );
  });

  it('should handle incoming messages from OpenAI and send speech to client', async () => {
    const mockRequest = {} as IncomingMessage;
    const clientSendSpy = jest.spyOn(mockClient, 'send');
    const openAiSendSpy = jest.spyOn(mockOpenAiWs, 'send');

    await service.handleConnection(mockClient, mockRequest);

    const mediaMessage = JSON.stringify({
      event: 'media',
      media: { payload: 'test-audio' },
    });

    mockClient.emit('message', mediaMessage);

    expect(openAiSendSpy).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: 'test-audio',
      }),
    );

    const openAiResponse = JSON.stringify({
      type: 'output_audio_buffer.append',
      audio: 'test-speech',
    });

    mockOpenAiWs.emit('message', openAiResponse);

    expect(clientSendSpy).toHaveBeenCalledWith(
      JSON.stringify({
        event: 'speech',
        speech: 'test-speech',
      }),
    );
  });
});
