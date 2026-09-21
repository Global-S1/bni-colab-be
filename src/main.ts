import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('BNITECH Colab API')
    .setDescription('Backend API para la plataforma colaborativa de equipos, proyectos y tareas de BNITECH / Global S1')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3002;
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 BNITECH Colab Backend iniciado en: http://localhost:${port}`);
  console.log(`📄 Documentación Swagger disponible en: http://localhost:${port}/api/docs`);
}
bootstrap();
