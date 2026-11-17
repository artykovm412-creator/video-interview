
import { useState, useRef, useEffect } from 'react';
import './App.css';

const SIGNALING_URL =
  'wss://inai-col3.fishrungames.com/signaling/';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

function App() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);

  const [cameraError, setCameraError] = useState('');
  const [loading, setLoading] = useState(true);
  const [videoReady, setVideoReady] = useState(false);
  const [remoteVideoReady, setRemoteVideoReady] = useState(false);

  const [camera, setCamera] = useState(true);
  const [microphone, setMicrophone] = useState(true);

  const [wsStatus, setWsStatus] = useState('Отключено');
  const [peerConnected, setPeerConnected] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const peerIdRef = useRef('');
  const helloReplySentRef = useRef(false);
  const offerStartedRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const clientIdRef = useRef(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  );

  function addMessage(message: string) {
    setMessages(previous => [...previous, message]);
  }

  // Отправка сообщения через WebSocket
  function sendSignal(data: object) {
    const ws = wsRef.current;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  // Добавление локальной камеры и микрофона в WebRTC
  function addLocalTracks(pc: RTCPeerConnection) {
    const localStream = streamRef.current;

    if (!localStream) return;

    localStream.getTracks().forEach(track => {
      const alreadyAdded = pc.getSenders().some(
        sender => sender.track === track
      );

      if (!alreadyAdded) {
        pc.addTrack(track, localStream);
      }
    });
  }

  // Создание WebRTC-соединения
  function createPeerConnection() {
    if (pcRef.current) {
      return pcRef.current;
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;

    addLocalTracks(pc);

    // Получение видео и звука собеседника
    pc.ontrack = event => {
      const incomingStream = event.streams[0];

      if (incomingStream) {
        setRemoteStream(incomingStream);
        addMessage('Получен медиапоток собеседника');
      }
    };

    // Отправка ICE-кандидатов собеседнику
    pc.onicecandidate = event => {
      if (event.candidate) {
        sendSignal({
          type: 'ice-candidate',
          candidate: event.candidate.toJSON(),
        });
      }
    };

    pc.onconnectionstatechange = () => {
      addMessage(
        'WebRTC: ' + pc.connectionState
      );

      if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed' ||
        pc.connectionState === 'disconnected'
      ) {
        setRemoteVideoReady(false);
      }
    };

    return pc;
  }

  // Добавление ICE-кандидатов, которые пришли раньше offer/answer
  async function addPendingCandidates(pc: RTCPeerConnection) {
    const candidates = pendingCandidatesRef.current;

    pendingCandidatesRef.current = [];

    for (const candidate of candidates) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.error('ICE candidate error:', error);
      }
    }
  }

  // Создание предложения для соединения
  async function createOffer() {
    const pc = createPeerConnection();

    if (offerStartedRef.current) return;

    offerStartedRef.current = true;

    try {
      const offer = await pc.createOffer();

      await pc.setLocalDescription(offer);

      sendSignal({
        type: 'offer',
        offer: pc.localDescription,
      });

      addMessage('Отправлено предложение WebRTC');
    } catch (error) {
      offerStartedRef.current = false;
      console.error('Offer error:', error);
      addMessage('Ошибка создания offer');
    }
  }

  // Обработка предложения от собеседника
  async function handleOffer(offer: RTCSessionDescriptionInit) {
    const pc = createPeerConnection();

    try {
      await pc.setRemoteDescription(
        new RTCSessionDescription(offer)
      );

      await addPendingCandidates(pc);

      const answer = await pc.createAnswer();

      await pc.setLocalDescription(answer);

      sendSignal({
        type: 'answer',
        answer: pc.localDescription,
      });

      addMessage('Отправлен ответ WebRTC');
    } catch (error) {
      console.error('Offer handling error:', error);
      addMessage('Ошибка обработки offer');
    }
  }

  // Обработка ответа собеседника
  async function handleAnswer(answer: RTCSessionDescriptionInit) {
    const pc = createPeerConnection();

    try {
      await pc.setRemoteDescription(
        new RTCSessionDescription(answer)
      );

      await addPendingCandidates(pc);

      addMessage('Ответ WebRTC получен');
    } catch (error) {
      console.error('Answer error:', error);
      addMessage('Ошибка обработки answer');
    }
  }

  // Обработка ICE-кандидата
  async function handleCandidate(candidate: RTCIceCandidateInit) {
    const pc = createPeerConnection();

    if (pc.remoteDescription) {
      try {
        await pc.addIceCandidate(candidate);
      } catch (error) {
        console.error('ICE error:', error);
      }
    } else {
      pendingCandidatesRef.current.push(candidate);
    }
  }

  // Камера и микрофон
  useEffect(() => {
    let mounted = true;
    let currentStream: MediaStream | null = null;

    async function startCamera() {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (!mounted) {
          media.getTracks().forEach(track => track.stop());
          return;
        }

        currentStream = media;
        streamRef.current = media;

        setStream(media);
        setCameraError('');

        if (pcRef.current) {
          addLocalTracks(pcRef.current);
        }
      } catch (error) {
        const err = error as Error;

        console.error('Camera error:', err);

        if (mounted) {
          setCameraError(`${err.name}: ${err.message}`);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    }

    startCamera();

    return () => {
      mounted = false;

      currentStream?.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    };
  }, []);

  // Отображение собственного видео
  useEffect(() => {
    const video = videoRef.current;

    if (!video || !stream) return;

    video.srcObject = stream;

    video.play().catch(error => {
      console.error('Local video error:', error);
    });

    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  // Отображение видео собеседника
  useEffect(() => {
    const video = remoteVideoRef.current;

    if (!video || !remoteStream) return;

    video.srcObject = remoteStream;

    video.play().catch(error => {
      console.error('Remote video error:', error);
    });

    return () => {
      video.srcObject = null;
    };
  }, [remoteStream]);

  // Сброс WebRTC
  function closePeerConnection() {
    if (pcRef.current) {
      pcRef.current.ontrack = null;
      pcRef.current.onicecandidate = null;
      pcRef.current.close();
      pcRef.current = null;
    }

    setRemoteStream(null);
    setRemoteVideoReady(false);

    peerIdRef.current = '';
    offerStartedRef.current = false;
    pendingCandidatesRef.current = [];
  }

  // Подключение к серверу
  function connectWebSocket() {
    if (
      wsRef.current &&
      (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      )
    ) {
      return;
    }

    closePeerConnection();

    setMessages([]);
    setPeerConnected(false);
    setWsStatus('Подключение...');

    helloReplySentRef.current = false;

    const ws = new WebSocket(SIGNALING_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus('Подключён');

      addMessage('Соединение с сервером установлено');

      // Сообщаем серверу свой идентификатор
      ws.send(JSON.stringify({
        type: 'hello',
        clientId: clientIdRef.current,
      }));

      addMessage('Отправлено hello');
    };

    ws.onmessage = async event => {
      console.log('Получено от сервера:', event.data);

      let message: any;

      try {
        message = JSON.parse(event.data);
      } catch {
        addMessage('Получен текст: ' + String(event.data));
        return;
      }

      if (message.type === 'peer-left') {
        addMessage('Собеседник отключился');

        setPeerConnected(false);
        closePeerConnection();

        return;
      }

      // Обнаружение второго пользователя
      if (message.type === 'hello') {
        if (message.clientId === clientIdRef.current) {
          return;
        }

        if (message.clientId) {
          peerIdRef.current = message.clientId;
        }

        setPeerConnected(true);

        addMessage('Собеседник обнаружен');

        // Повторно отправляем hello, чтобы оба браузера
        // узнали идентификаторы друг друга
        if (!helloReplySentRef.current) {
          helloReplySentRef.current = true;

          ws.send(JSON.stringify({
            type: 'hello',
            clientId: clientIdRef.current,
          }));
        }

        // Только один браузер создаёт offer
        if (
          peerIdRef.current &&
          clientIdRef.current < peerIdRef.current
        ) {
          await createOffer();
        }

        return;
      }

      if (message.type === 'offer') {
        addMessage('Получено предложение WebRTC');

        await handleOffer(message.offer);

        return;
      }

      if (message.type === 'answer') {
        addMessage('Получен ответ WebRTC');

        await handleAnswer(message.answer);

        return;
      }

      if (message.type === 'ice-candidate') {
        if (message.candidate) {
          await handleCandidate(message.candidate);
        }

        return;
      }

      if (message.type === 'test-message') {
        addMessage('СОБЕСЕДНИК НАПИСАЛ: ' + message.text);
        return;
      }

      addMessage(
        'Получено сообщение: ' + JSON.stringify(message)
      );
    };

    ws.onerror = () => {
      setWsStatus('Ошибка');
      addMessage('Ошибка WebSocket');
    };

    ws.onclose = () => {
      setWsStatus('Отключено');
      setPeerConnected(false);

      closePeerConnection();

      if (wsRef.current === ws) {
        wsRef.current = null;
      }

      addMessage('Соединение закрыто');
    };
  }

  // Отключение от сервера
  function disconnectWebSocket() {
    closePeerConnection();

    const ws = wsRef.current;

    if (ws) {
      ws.close();
      wsRef.current = null;
    }

    setWsStatus('Отключено');
    setPeerConnected(false);
  }

  // Тестовое сообщение
  function sendTestMessage() {
    const ws = wsRef.current;

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      addMessage('Нет подключения к серверу');
      return;
    }

    ws.send(JSON.stringify({
      type: 'test-message',
      text: 'Привет! Проверка WebSocket работает!',
    }));

    addMessage('Тестовое сообщение отправлено серверу');
  }

  // Камера
  function toggleCamera() {
    const track = stream?.getVideoTracks()[0];

    if (track) {
      track.enabled = !track.enabled;
      setCamera(track.enabled);
    }
  }

  // Микрофон
  function toggleMicrophone() {
    const track = stream?.getAudioTracks()[0];

    if (track) {
      track.enabled = !track.enabled;
      setMicrophone(track.enabled);
    }
  }

  // Очистка при закрытии страницы
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      pcRef.current?.close();
    };
  }, []);

  return (
    <div className="app">
      <header className="header">
        <h1>Video<span>Interview</span></h1>

        <div className="status">
          <span className="status-dot"></span>
          {videoReady ? 'Камера работает' : 'Ожидание видео'}
        </div>
      </header>

      <main className="main">
        <div className="welcome">
          <h2>Видеособеседование 1 на 1</h2>
          <p>Общайтесь с собеседником в режиме реального времени</p>
        </div>

        <div className="videos">
          {/* Собственное видео */}
          <div className="video-card">
            <div className="video-wrapper">
              <video
                ref={videoRef}
                className="video-element"
                autoPlay
                playsInline
                muted
                onPlaying={() => setVideoReady(true)}
                onPause={() => setVideoReady(false)}
              />

              {(!videoReady || !camera) && (
                <div className="video-overlay">
                  <span>👤</span>
                  <p>
                    {!stream
                      ? loading
                        ? 'Загрузка видео...'
                        : 'Камера недоступна'
                      : !camera
                        ? 'Камера выключена'
                        : 'Загрузка видео...'}
                  </p>
                </div>
              )}
            </div>

            <div className="video-name">Вы</div>
          </div>

          {/* Видео собеседника */}
          <div className="video-card">
            <div className="video-wrapper">
              <video
                ref={remoteVideoRef}
                className="video-element"
                autoPlay
                playsInline
                onPlaying={() => setRemoteVideoReady(true)}
                onPause={() => setRemoteVideoReady(false)}
              />

              {!remoteVideoReady && (
                <div className="video-placeholder">
                  <span>👥</span>
                  <p>
                    {peerConnected
                      ? 'Ожидание видео собеседника...'
                      : 'Ожидание собеседника...'}
                  </p>
                </div>
              )}
            </div>

            <div className="video-name">Собеседник</div>
          </div>
        </div>

        {cameraError && (
          <div className="error">
            <strong>Ошибка камеры:</strong>
            <p>{cameraError}</p>
          </div>
        )}

        <div className="controls">
          <button
            className={microphone ? 'control active' : 'control off'}
            onClick={toggleMicrophone}
            disabled={!stream}
          >
            {microphone ? '🎤 Микрофон' : '🔇 Микрофон'}
          </button>

          <button
            className={camera ? 'control active' : 'control off'}
            onClick={toggleCamera}
            disabled={!stream}
          >
            {camera ? '📷 Камера' : '🚫 Камера'}
          </button>
        </div>

        <section className="connection-panel">
          <h3>Подключение к собеседнику</h3>

          <p className="connection-status">
            WebSocket: <strong>{wsStatus}</strong>
          </p>

          <p className="connection-status">
            Собеседник: <strong>
              {peerConnected ? 'Подключён' : 'Не подключён'}
            </strong>
          </p>

          <div className="connection-buttons">
            <button
              className="connect"
              onClick={connectWebSocket}
              disabled={
                wsStatus === 'Подключение...' ||
                wsStatus === 'Подключён'
              }
            >
              Подключиться к серверу
            </button>

            <button
              className="disconnect"
              onClick={disconnectWebSocket}
            >
              Отключиться
            </button>
          </div>

          <button
            className="test-button"
            onClick={sendTestMessage}
            disabled={!peerConnected}
          >
            Отправить тестовое сообщение
          </button>

          <div className="message-box">
            <strong>Журнал соединения:</strong>

            {messages.length === 0 ? (
              <p>Пока сообщений нет</p>
            ) : (
              messages.map((message, index) => (
                <p key={index}>{message}</p>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
