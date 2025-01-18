import { Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { AppService } from './app.service';
import { VoiceGateway } from './voiceGateway.service';
const twilio = require('twilio');

@Controller('call')
export class AppController {
  constructor(
    private readonly appService: AppService,
  ) {}

  @Get()
  initiateCall() {
    return this.appService.initiateCall('+260971445269');
  }
}
