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

await app.listen(process.env.PORT ?? 3000);}
bootstrap();
