import { useRef, useState } from 'react';
import { Alert, AlertIcon, Box, Button, Container, Heading, HStack, Text, VStack } from '@chakra-ui/react';

export default function CameraTest() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const testCamera = async () => {
    setBusy(true);
    setError('');
    setStatus('Requesting camera access...');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia is not supported in this browser');
      setStatus('Browser supports getUserMedia. Requesting camera...');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
      setStatus('Camera access granted! Setting up video...');
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus('Success: Camera is working!');
      }
    } catch (e: any) {
      setError(e?.message || 'Camera access failed');
    } finally {
      setBusy(false);
    }
  };

  const stopCamera = () => {
    const el = videoRef.current as HTMLVideoElement | null;
    const stream = el?.srcObject as MediaStream | null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (el) el.srcObject = null;
    setStatus('Camera stopped');
  };

  return (
    <Container maxW="lg" py={10}>
      <VStack align="stretch" spacing={6}>
        <Heading size="md">Camera Test</Heading>
        <HStack>
          <Button onClick={testCamera} isLoading={busy} colorScheme="blue">Test Camera</Button>
          <Button onClick={stopCamera} variant="outline">Stop Camera</Button>
        </HStack>
        {status && (
          <Alert status="info">
            <AlertIcon />
            <Text>{status}</Text>
          </Alert>
        )}
        {error && (
          <Alert status="error">
            <AlertIcon />
            <Text>{error}</Text>
          </Alert>
        )}
        <Box bg="black" borderRadius="md" overflow="hidden" h="300px">
          <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </Box>
        <Text fontSize="sm" color="gray.500">If this works, your browser can access the camera. Any call issues are likely signaling or network.</Text>
      </VStack>
    </Container>
  );
}

