# AI-Powered Dental Virtual Receptionist

A virtual receptionist system that uses OpenAI's GPT-4, Twilio, and Google Speech-to-Text to handle dental clinic phone calls.

## What I Did

### 1. OpenAI Integration

- Implemented real-time communication with OpenAI's GPT-4 API using WebSocket.
- Created a dental receptionist persona with specific guidelines and protocols.
- Configured speech-to-text and text-to-speech capabilities using OpenAI's response JSON and Google Speech-to-Text.
- Set up automatic reconnection handling for WebSocket disconnections.\
  [OpenAI Real-time setup](https://platform.openai.com/docs/api-reference/realtime)

### 2. Twilio Integration

- Set up voice call handling using Twilio's programmable voice API.
- Implemented media streaming for real-time audio processing.
- Created TwiML responses for call flow management.
- Configured audio stream interception.\
  [Twilio API setup](https://platform.openai.com/docs/api-reference/realtime)

### 3. Google Speech-to-Text Integration

- Implemented call audio transcription using Google's Speech-to-Text API to handle an audio buffer.
- Configured for phone call audio format (MULAW, 8 kHz).

## How It Works

1. **Call Initiation**

   - On a GET request, a call from a registered Twilio phone number places a phone call to a verified phone number.
   - The system creates a new call session.
   - A call stream is created and connected to the local WebSocket server routed through an ngrok server.
   - A greeting message is played to the client.
   - The initial greeting is played.

2. **Real-time Processing**

   ```mermaid
   graph LR
   A[Outgoing Call] --> B[Twilio Media Stream]
   B --> C[OpenAI Real-time Processing]
   B --> D[Google Speech-to-Text]
   C --> E[AI Response]
   E --> F[Text-to-Speech]
   F --> G[Audio Response to Caller]
   ```

3. **Audio Processing Flow**

   - Incoming audio is streamed in real-time.
   - Dual transcription processing (OpenAI and Google).
   - AI generates contextual responses.
   - Responses are converted to speech and played back.

## Challenges & Solutions

### 1. WebSocket Connection Stability

**Challenge:** OpenAI WebSocket connections would occasionally drop due to poor network connectivity.
**Solution:** Implemented:

- Connection timeout handling.
- Automatic reconnection.
- Session cleanup.

```typescript
private async handleOpenAiDisconnect() {
  console.log('Attempting to reconnect to OpenAI...');
  try {
    await this.initializeOpenAiConnection();
  } catch (error) {
    console.error('Failed to reconnect to OpenAI:', error);
  }
}
```
### 2. Google Transcription Limit

**Challenge:** Only the first few bits of the conversation would be transcribed before I hit the request limit on my account.

### 3. Twilio Inability to Add Multiple Verified Numbers

**Challenge:** Had to create multiple accounts to use different numbers that could be called.

## Results

**Twilio Call and Stream Initiation**

![Screenshot of Console](./twillio_call_logs.png)

**Google API Transaction**

![Screenshot of Console](./trancription_logs.png)

## Environment Setup

Required environment variables:

```
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=your_phone_number
OPENAI_API_KEY=your_openai_key
```

[Google Cloud Authentication for API using CLI](https://cloud.google.com/speech-to-text/docs/speech-to-text-client-libraries)


