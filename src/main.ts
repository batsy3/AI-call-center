import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const wsAdapter = new WsAdapter(app);
  app.useWebSocketAdapter(wsAdapter);

  app.enableCors({
    origin: true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['content-type'],
  });

  await app.listen(3000);
}
console.log(`Server is running on port ${3000}`);

bootstrap();
