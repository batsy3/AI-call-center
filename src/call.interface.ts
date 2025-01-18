export interface CallMetadata {
  callSid: string;
  from: string;
  to: string;
  status: 'initiated' | 'connected' | 'ended';
  initialGreeting?: string;
}
