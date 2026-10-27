export interface ChatMessage {
  id: string;
  channel: string;
  userId: string;
  userLogin: string;
  displayName: string;
  text: string;
  isMod: boolean;
  isBroadcaster: boolean;
  isBot: boolean;
  sentAt: string;
}

export interface ChatSource {
  start(onMessage: (message: ChatMessage) => void): Promise<void>;
  stop(): Promise<void>;
}
