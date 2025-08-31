import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Box, Button, Container, Heading, HStack, Input, Text, VStack, useToast, Divider, Tag, SimpleGrid } from '@chakra-ui/react';
import { loadUser, saveUser, type ClientUser } from '../lib/authClient';

async function createRoom(token: string, id?: string, email?: string) {
  const res = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(email ? { 'X-User-Email': email } : {}) },
    body: JSON.stringify({ id }),
  });
  return res.json();
}

export default function Home() {
  const router = useRouter();
  const [roomIdInput, setRoomIdInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [classId, setClassId] = useState('math101');
  const [user, setUser] = useState<ClientUser | null>(null);
  const toast = useToast();

  useEffect(() => {
    setUser(loadUser());
  }, []);

  const onCreate = async () => {
    setBusy(true);
    try {
      if (!user) throw new Error('Login required');
      if (user.role !== 'teacher') throw new Error('Only teacher can create rooms');
      const data = await createRoom(user.token, undefined, user.email);
      if (!data?.ok || !data?.roomId) throw new Error(data?.error || 'Failed to create room');
      await router.push(`/call/${data.roomId}`);
    } catch (e: any) {
      toast({ title: e?.message || 'Failed to create room', status: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async () => {
    if (!roomIdInput.trim()) {
      toast({ title: 'Enter a room ID', status: 'warning' });
      return;
    }
    setBusy(true);
    try {
      await router.push(`/call/${roomIdInput.trim()}`);
    } finally {
      setBusy(false);
    }
  };

  const doLogin = async (emailIn: string, classIdIn: string) => {
    setBusy(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailIn, classId: classIdIn }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.message || 'Login failed');
      const u: ClientUser = data.user;
      saveUser(u);
      setUser(u);
      toast({ title: `Logged in as ${u.name} (${u.role})`, status: 'success' });
    } catch (e: any) {
      toast({ title: e?.message || 'Login failed', status: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Container maxW="lg" py={16}>
      <VStack spacing={8} align="stretch">
        <Heading textAlign="center">Classense Demo</Heading>
        {!user ? (
          <>
            <Box>
              <Text mb={2} fontWeight="semibold">Login</Text>
              <VStack align="stretch" spacing={3}>
                <Input placeholder="email (e.g. teacher@math101)" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Input placeholder="classId (math101)" value={classId} onChange={(e) => setClassId(e.target.value)} />
                <Button colorScheme="blue" onClick={() => doLogin(email, classId)} isLoading={busy}>Login</Button>
              </VStack>
            </Box>
            <Divider />
            <Box>
              <Text mb={2} fontWeight="semibold">Mock users</Text>
              <SimpleGrid columns={2} spacing={3}>
                <Button variant="outline" onClick={() => doLogin('teacher@math101', 'math101')}>
                  Professor Smith <Tag ml={2}>teacher</Tag>
                </Button>
                <Button variant="outline" onClick={() => doLogin('student1@math101', 'math101')}>
                  Alice Johnson <Tag ml={2}>student</Tag>
                </Button>
                <Button variant="outline" onClick={() => doLogin('student2@math101', 'math101')}>
                  Bob Wilson <Tag ml={2}>student</Tag>
                </Button>
              </SimpleGrid>
            </Box>
          </>
        ) : (
          <>
            <Box>
              <Text>Welcome, <b>{user.name}</b> <Tag ml={2}>{user.role}</Tag></Text>
              <Text fontSize="sm" color="gray.500">Class: {user.classId}</Text>
            </Box>
            {user.role === 'teacher' ? (
              <>
                <Button colorScheme="blue" onClick={onCreate} isLoading={busy}>Create New Room</Button>
                <HStack>
                  <Input placeholder="Enter room ID" value={roomIdInput} onChange={(e) => setRoomIdInput(e.target.value)} />
                  <Button onClick={onJoin} isLoading={busy}>Join</Button>
                </HStack>
                <Text fontSize="sm" color="gray.500">Only teachers can create rooms. After creating, copy/share the URL shown on the call page.</Text>
              </>
            ) : (
              <>
                <HStack>
                  <Input placeholder="Enter room ID from your teacher" value={roomIdInput} onChange={(e) => setRoomIdInput(e.target.value)} />
                  <Button onClick={onJoin} isLoading={busy}>Join</Button>
                </HStack>
                <Text fontSize="sm" color="gray.500">You must be logged in to join a call. Use the URL or room ID shared by your teacher.</Text>
              </>
            )}
          </>
        )}
        <Box fontSize="sm" color="gray.500">
          Note: getUserMedia/WebRTC requires a secure context. It works on https or on http://localhost for local testing.
        </Box>
      </VStack>
    </Container>
  );
}
