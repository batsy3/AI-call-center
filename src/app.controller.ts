import { Controller, Post, Req } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post()
  makeCall(@Req() request:Request): string {
    return this.appService.getHello();
  }


}
