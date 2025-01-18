import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import config from './config';
import { AudioService } from './audio.service';
import { CallMetadata } from './call.interface';
import { VoiceGateway } from './voiceGateway.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      load: [config],
      isGlobal: true,
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    AudioService,
    {
      provide: 'ACTIVE_CALLS',
      useFactory: () => new Map<string, CallMetadata>(),
    },
    VoiceGateway,
  ],
})
export class AppModule {}
