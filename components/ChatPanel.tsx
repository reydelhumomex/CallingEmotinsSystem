import { useEffect, useRef, useState } from 'react';
import { Box, Button, HStack, IconButton, Input, Text, VStack } from '@chakra-ui/react';
import { ArrowUpIcon } from '@chakra-ui/icons';

export type ChatMessage = {
  id?: number;
  text: string;
  senderName?: string;
  senderEmail?: string;
  peerId?: string;
  ts?: number;
  self?: boolean;
};

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (text: string) => void;
  title?: string;
}

export default function ChatPanel({ messages, onSend, title = 'Class Chat' }: ChatPanelProps) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Auto scroll to bottom on new messages
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight + 1000;
  }, [messages.length]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  return (
    <VStack align="stretch" spacing={3}>
      <Text fontWeight="semibold">{title}</Text>
      <Box ref={listRef} borderWidth="1px" borderRadius="md" p={3} h="260px" overflowY="auto" bg="whiteAlpha.50">
        <VStack align="stretch" spacing={2}>
          {messages.map((m, idx) => (
            <Box key={m.id ?? idx} alignSelf={m.self ? 'flex-end' : 'flex-start'} maxW="80%">
              <Box
                px={3}
                py={2}
                borderRadius="lg"
                bg={m.self ? 'blue.500' : 'gray.200'}
                color={m.self ? 'white' : 'gray.800'}
                boxShadow="sm"
              >
                {!m.self && (
                  <Text fontSize="xs" opacity={0.7} mb={1} noOfLines={1}>
                    {m.senderName || m.senderEmail || m.peerId || 'Anon'}
                  </Text>
                )}
                <Text whiteSpace="pre-wrap">{m.text}</Text>
                {m.ts && (
                  <Text fontSize="xs" opacity={0.6} mt={1} textAlign="right">
                    {new Date(m.ts).toLocaleTimeString()}
                  </Text>
                )}
              </Box>
            </Box>
          ))}
        </VStack>
      </Box>
      <HStack>
        <Input
          placeholder="Type a message"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <IconButton aria-label="Send" icon={<ArrowUpIcon />} colorScheme="blue" onClick={send} />
      </HStack>
    </VStack>
  );
}

