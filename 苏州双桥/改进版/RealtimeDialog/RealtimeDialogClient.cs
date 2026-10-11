using Newtonsoft.Json;
using System;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;

namespace RealtimeDialog
{
    public class RealtimeDialogClient : IDisposable
    {
        private readonly ClientWebSocket _webSocket;
        private readonly ClientConfig _config;
        private readonly CancellationTokenSource _cts;
        private readonly Channel<byte[]> _sendChannel;
        private Task? _receiveTask;
        private Task? _sendTask;
        private bool _isConnected = false;
        private bool _isSessionActive = false;
        private string? _currentSessionId;

        public event EventHandler? ConnectionStarted;
        public event EventHandler<ErrorEventArgs>? ConnectionFailed;
        public event EventHandler? ConnectionFinished;
        public event EventHandler<SessionStartedEventArgs>? SessionStarted;
        public event EventHandler? SessionFinished;
        public event EventHandler<ErrorEventArgs>? SessionFailed;
        public event EventHandler<ASRResultEventArgs>? ASRInfoReceived;
        public event EventHandler<ASRResultEventArgs>? ASRResultReceived;
        public event EventHandler<ServerEventArgs>? ASREnded;
        public event EventHandler<ChatResponseEventArgs>? ChatResponseReceived;
        public event EventHandler<ChatResponseEventArgs>? ChatEnded;
        public event EventHandler<AudioDataEventArgs>? TTSAudioReceived;
        public event EventHandler<ErrorEventArgs>? ErrorReceived;

        public string? CurrentSessionId => _currentSessionId;
        public bool IsConnected => _isConnected && _webSocket.State == WebSocketState.Open;
        public bool IsSessionActive => _isSessionActive;

        public RealtimeDialogClient(ClientConfig config)
        {
            _config = config ?? throw new ArgumentNullException(nameof(config));
            _webSocket = new ClientWebSocket();
            _cts = new CancellationTokenSource();
            _sendChannel = Channel.CreateUnbounded<byte[]>();
        }

        public async Task ConnectAsync(CancellationToken cancellationToken = default)
        {
            if (_isConnected)
                throw new InvalidOperationException("Already connected");

            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, cancellationToken);

            try
            {
                var connectId = Guid.NewGuid().ToString();
                
                _webSocket.Options.SetRequestHeader("X-Api-App-Id", _config.AppId);
                _webSocket.Options.SetRequestHeader("X-Api-Access-Key", _config.AccessToken);
                _webSocket.Options.SetRequestHeader("X-Api-Resource-Id", "volc.speech.dialog");
                _webSocket.Options.SetRequestHeader("X-Api-App-Key", _config.AppKey);
                _webSocket.Options.SetRequestHeader("X-Api-Connect-Id", connectId);

                await _webSocket.ConnectAsync(new Uri(_config.WebSocketUrl), linkedCts.Token);
                _isConnected = true;

                _receiveTask = ReceiveLoopAsync(linkedCts.Token);
                _sendTask = SendLoopAsync(linkedCts.Token);

                await SendEventAsync(ClientEventId.StartConnection, null, "{}");
            }
            catch (Exception ex)
            {
                _isConnected = false;
                ConnectionFailed?.Invoke(this, new ErrorEventArgs { Error = ex.Message });
                throw;
            }
        }

        public async Task DisconnectAsync(CancellationToken cancellationToken = default)
        {
            if (!_isConnected) return;

            using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(_cts.Token, cancellationToken);

            try
            {
                if (_isSessionActive)
                {
                    await FinishSessionAsync(linkedCts.Token);
                }

                await SendEventAsync(ClientEventId.FinishConnection, null, "{}");
                await Task.Delay(100, linkedCts.Token);

                _cts.Cancel();
                
                if (_webSocket.State == WebSocketState.Open || _webSocket.State == WebSocketState.CloseReceived)
                {
                    await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", linkedCts.Token);
                }
            }
            catch { }
            finally
            {
                _isConnected = false;
                _isSessionActive = false;
                _currentSessionId = null;
            }
        }

        public async Task StartSessionAsync(StartSessionRequest request, CancellationToken cancellationToken = default)
        {
            EnsureConnected();

            if (_isSessionActive)
                throw new InvalidOperationException("Session already active");

            _currentSessionId = Guid.NewGuid().ToString();
            
            var json = JsonConvert.SerializeObject(request);
            await SendEventAsync(ClientEventId.StartSession, _currentSessionId, json, cancellationToken);
        }

        public async Task FinishSessionAsync(CancellationToken cancellationToken = default)
        {
            EnsureConnected();
            EnsureSessionActive();

            await SendEventAsync(ClientEventId.FinishSession, _currentSessionId, "{}", cancellationToken);
            _isSessionActive = false;
        }

        public async Task SendAudioAsync(byte[] audioData, CancellationToken cancellationToken = default)
        {
            EnsureConnected();
            EnsureSessionActive();

            var message = ProtocolMessage.CreateAudioRequest(_currentSessionId!, audioData);
            var data = message.Encode();
            await _sendChannel.Writer.WriteAsync(data, cancellationToken);
        }

        public async Task SendChatTextQueryAsync(string content, CancellationToken cancellationToken = default)
        {
            EnsureConnected();
            EnsureSessionActive();

            var request = new ChatTextQueryRequest { Content = content };
            var json = JsonConvert.SerializeObject(request);
            await SendEventAsync(ClientEventId.ChatTextQuery, _currentSessionId, json, cancellationToken);
        }

        public async Task SendClientInterruptAsync(CancellationToken cancellationToken = default)
        {
            EnsureConnected();
            EnsureSessionActive();
            await SendEventAsync(ClientEventId.ClientInterrupt, _currentSessionId, "{}", cancellationToken);
        }

        public async Task SayHelloAsync(string content, CancellationToken cancellationToken = default)
        {
            EnsureConnected();
            EnsureSessionActive();

            var request = new SayHelloRequest { Content = content };
            var json = JsonConvert.SerializeObject(request);
            await SendEventAsync(ClientEventId.SayHello, _currentSessionId, json, cancellationToken);
        }

        private async Task SendEventAsync(ClientEventId eventId, string? sessionId, string jsonPayload, CancellationToken cancellationToken = default)
        {
            var message = ProtocolMessage.CreateClientEvent(eventId, sessionId, jsonPayload);
            var data = message.Encode();
            await _sendChannel.Writer.WriteAsync(data, cancellationToken);
        }

        private async Task SendLoopAsync(CancellationToken cancellationToken)
        {
            try
            {
                await foreach (var data in _sendChannel.Reader.ReadAllAsync(cancellationToken))
                {
                    await _webSocket.SendAsync(
                        new ArraySegment<byte>(data),
                        WebSocketMessageType.Binary,
                        true,
                        cancellationToken);
                }
            }
            catch { }
        }

        private async Task ReceiveLoopAsync(CancellationToken cancellationToken)
        {
            var buffer = new byte[8192];
            var messageBuffer = new List<byte>();

            try
            {
                while (!cancellationToken.IsCancellationRequested && 
                       _webSocket.State == WebSocketState.Open)
                {
                    var result = await _webSocket.ReceiveAsync(
                        new ArraySegment<byte>(buffer), cancellationToken);

                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        break;
                    }

                    messageBuffer.AddRange(buffer.Take(result.Count));

                    if (result.EndOfMessage)
                    {
                        var messageData = messageBuffer.ToArray();
                        messageBuffer.Clear();
                        await ProcessMessageAsync(messageData);
                    }
                }
            }
            catch (OperationCanceledException) { }
            catch (Exception ex)
            {
                ErrorReceived?.Invoke(this, new ErrorEventArgs { Error = $"Receive error: {ex.Message}" });
            }
            finally
            {
                ConnectionFinished?.Invoke(this, EventArgs.Empty);
            }
        }

        private async Task ProcessMessageAsync(byte[] data)
        {
            try
            {
                var message = ProtocolMessage.Decode(data);
                var eventId = message.EventId ?? 0;
                var sessionId = message.SessionId;
                var payloadJson = Encoding.UTF8.GetString(message.Payload);

                await Task.CompletedTask;

                switch ((ServerEventId)eventId)
                {
                    case ServerEventId.ConnectionStarted:
                        ConnectionStarted?.Invoke(this, EventArgs.Empty);
                        break;

                    case ServerEventId.SessionStarted:
                        _isSessionActive = true;
                        var sessionResp = JsonConvert.DeserializeObject<SessionStartedResponse>(payloadJson);
                        SessionStarted?.Invoke(this, new SessionStartedEventArgs 
                        { 
                            SessionId = sessionId,
                            DialogId = sessionResp?.DialogId
                        });
                        break;

                    case ServerEventId.SessionFinished:
                        _isSessionActive = false;
                        SessionFinished?.Invoke(this, EventArgs.Empty);
                        break;

                    case ServerEventId.SessionFailed:
                        _isSessionActive = false;
                        var sessionError = JsonConvert.DeserializeObject<ErrorResponse>(payloadJson);
                        SessionFailed?.Invoke(this, new ErrorEventArgs 
                        { 
                            Error = sessionError?.Error,
                            SessionId = sessionId
                        });
                        break;

                    case ServerEventId.ASRInfo:
                        var asrInfo = JsonConvert.DeserializeObject<ASRInfoResponse>(payloadJson);
                        ASRInfoReceived?.Invoke(this, new ASRResultEventArgs
                        {
                            SessionId = sessionId,
                            QuestionId = asrInfo?.QuestionId
                        });
                        break;

                    case ServerEventId.ASRResponse:
                        var asrResp = JsonConvert.DeserializeObject<ASRResponse>(payloadJson);
                        if (asrResp?.Results != null && asrResp.Results.Count > 0)
                        {
                            var result = asrResp.Results[0];
                            ASRResultReceived?.Invoke(this, new ASRResultEventArgs
                            {
                                SessionId = sessionId,
                                Text = result.Text,
                                IsInterim = result.IsInterim
                            });
                        }
                        break;

                    case ServerEventId.ASREnded:
                        ASREnded?.Invoke(this, new ServerEventArgs { SessionId = sessionId });
                        break;

                    case ServerEventId.ChatResponse:
                        var chatResp = JsonConvert.DeserializeObject<ChatResponse>(payloadJson);
                        ChatResponseReceived?.Invoke(this, new ChatResponseEventArgs
                        {
                            SessionId = sessionId,
                            Content = chatResp?.Content,
                            QuestionId = chatResp?.QuestionId,
                            ReplyId = chatResp?.ReplyId
                        });
                        break;

                    case ServerEventId.ChatEnded:
                        var chatEnd = JsonConvert.DeserializeObject<ChatEndedResponse>(payloadJson);
                        ChatEnded?.Invoke(this, new ChatResponseEventArgs
                        {
                            SessionId = sessionId,
                            QuestionId = chatEnd?.QuestionId,
                            ReplyId = chatEnd?.ReplyId
                        });
                        break;

                    case ServerEventId.TTSResponse:
                        TTSAudioReceived?.Invoke(this, new AudioDataEventArgs
                        {
                            SessionId = sessionId,
                            AudioData = message.Payload
                        });
                        break;

                    case ServerEventId.DialogCommonError:
                        var error = JsonConvert.DeserializeObject<DialogCommonErrorResponse>(payloadJson);
                        ErrorReceived?.Invoke(this, new ErrorEventArgs
                        {
                            SessionId = sessionId,
                            StatusCode = error?.StatusCode,
                            Message = error?.Message
                        });
                        break;

                    default:
                        break;
                }
            }
            catch (Exception ex)
            {
                ErrorReceived?.Invoke(this, new ErrorEventArgs 
                { 
                    Error = $"Message processing error: {ex.Message}" 
                });
            }
        }

        private void EnsureConnected()
        {
            if (!IsConnected)
                throw new InvalidOperationException("Not connected to server");
        }

        private void EnsureSessionActive()
        {
            if (!_isSessionActive)
                throw new InvalidOperationException("No active session");
        }

        public void Dispose()
        {
            _cts.Cancel();
            
            try
            {
                if (_webSocket.State == WebSocketState.Open)
                {
                    _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Disposing", CancellationToken.None).Wait(TimeSpan.FromSeconds(2));
                }
            }
            catch { }
            
            _webSocket.Dispose();
            _cts.Dispose();
        }
    }
}
