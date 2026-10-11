using System;
using System.Buffers.Binary;
using System.IO;
using System.Text;

namespace RealtimeDialog
{
    /// <summary>
    /// 字节序转换辅助类
    /// </summary>
    public static class ByteOrder
    {
        /// <summary>
        /// 将int转换为大端序字节数组
        /// </summary>
        public static byte[] GetBytesBigEndian(int value)
        {
            byte[] bytes = new byte[4];
            BinaryPrimitives.WriteInt32BigEndian(bytes, value);
            return bytes;
        }
    }

    /// <summary>
    /// 消息类型
    /// </summary>
    public enum MessageType : byte
    {
        /// <summary>
        /// 客户端发送文本事件
        /// </summary>
        FullClientRequest = 0b0001,
        
        /// <summary>
        /// 服务器返回的文本事件
        /// </summary>
        FullServerResponse = 0b1001,
        
        /// <summary>
        /// 客户端发送音频数据
        /// </summary>
        AudioOnlyRequest = 0b0010,
        
        /// <summary>
        /// 服务器返回音频数据
        /// </summary>
        AudioOnlyResponse = 0b1011,
        
        /// <summary>
        /// 服务器返回的错误事件
        /// </summary>
        ErrorInformation = 0b1111
    }

    /// <summary>
    /// 序列化方法
    /// </summary>
    public enum SerializationMethod : byte
    {
        /// <summary>
        /// 无特殊序列化（二进制音频数据）
        /// </summary>
        Raw = 0b0000,
        
        /// <summary>
        /// JSON（文本类型消息）
        /// </summary>
        Json = 0b0001
    }

    /// <summary>
    /// 压缩方法
    /// </summary>
    public enum CompressionMethod : byte
    {
        /// <summary>
        /// 无压缩
        /// </summary>
        None = 0b0000,
        
        /// <summary>
        /// gzip压缩
        /// </summary>
        Gzip = 0b0001
    }

    /// <summary>
    /// 客户端事件ID
    /// </summary>
    public enum ClientEventId : int
    {
        StartConnection = 1,
        FinishConnection = 2,
        StartSession = 100,
        FinishSession = 102,
        TaskRequest = 200,
        UpdateConfig = 201,
        SayHello = 300,
        EndASR = 400,
        ChatTTSText = 500,
        ChatTextQuery = 501,
        ChatRAGText = 502,
        ConversationCreate = 510,
        ConversationUpdate = 511,
        ConversationRetrieve = 512,
        ConversationTruncate = 513,
        ConversationDelete = 514,
        ClientInterrupt = 515
    }

    /// <summary>
    /// 服务端事件ID
    /// </summary>
    public enum ServerEventId : int
    {
        ConnectionStarted = 50,
        ConnectionFailed = 51,
        ConnectionFinished = 52,
        SessionStarted = 150,
        SessionFinished = 152,
        SessionFailed = 153,
        UsageResponse = 154,
        ConfigUpdated = 251,
        TTSSentenceStart = 350,
        TTSSentenceEnd = 351,
        TTSResponse = 352,
        TTSEnded = 359,
        ASRInfo = 450,
        ASRResponse = 451,
        ASREnded = 459,
        ChatResponse = 550,
        ChatTextQueryConfirmed = 553,
        ChatEnded = 559,
        ConversationCreated = 567,
        ConversationUpdated = 568,
        ConversationRetrieved = 569,
        ConversationTruncated = 570,
        ConversationDeleted = 571,
        DialogCommonError = 599
    }

    /// <summary>
    /// 协议头
    /// </summary>
    public struct ProtocolHeader
    {
        public byte ProtocolVersion;  // 左4位
        public byte HeaderSize;       // 右4位
        public MessageType MessageType;
        public byte MessageTypeSpecificFlags;
        public SerializationMethod SerializationMethod;
        public CompressionMethod CompressionMethod;
        public byte Reserved;

        public ProtocolHeader()
        {
            ProtocolVersion = 0b0001;  // v1
            HeaderSize = 0b0001;       // 4字节
            MessageType = MessageType.FullClientRequest;
            MessageTypeSpecificFlags = 0;
            SerializationMethod = SerializationMethod.Json;
            CompressionMethod = CompressionMethod.None;
            Reserved = 0x00;
        }

        public byte[] ToBytes()
        {
            byte[] bytes = new byte[4];
            bytes[0] = (byte)((ProtocolVersion << 4) | HeaderSize);
            bytes[1] = (byte)(((byte)MessageType << 4) | MessageTypeSpecificFlags);
            bytes[2] = (byte)(((byte)SerializationMethod << 4) | (byte)CompressionMethod);
            bytes[3] = Reserved;
            return bytes;
        }

        public static ProtocolHeader FromBytes(byte[] bytes)
        {
            if (bytes.Length < 4)
                throw new ArgumentException("Header must be at least 4 bytes");

            var header = new ProtocolHeader
            {
                ProtocolVersion = (byte)((bytes[0] >> 4) & 0x0F),
                HeaderSize = (byte)(bytes[0] & 0x0F),
                MessageType = (MessageType)((bytes[1] >> 4) & 0x0F),
                MessageTypeSpecificFlags = (byte)(bytes[1] & 0x0F),
                SerializationMethod = (SerializationMethod)((bytes[2] >> 4) & 0x0F),
                CompressionMethod = (CompressionMethod)(bytes[2] & 0x0F),
                Reserved = bytes[3]
            };
            return header;
        }
    }

    /// <summary>
    /// 可选字段标志位
    /// </summary>
    public static class MessageFlags
    {
        /// <summary>
        /// 没有sequence字段
        /// </summary>
        public const byte NoSequence = 0b0000;
        
        /// <summary>
        /// 序号大于0的非终端数据包
        /// </summary>
        public const byte SequenceNonTerminal = 0b0001;
        
        /// <summary>
        /// 最后一个无序号的数据包
        /// </summary>
        public const byte LastNoSequence = 0b0010;
        
        /// <summary>
        /// 最后一个序号小于0的数据包（一般用-1表示）
        /// </summary>
        public const byte LastNegativeSequence = 0b0011;
        
        /// <summary>
        /// 携带事件ID
        /// </summary>
        public const byte HasEventId = 0b0100;
    }

    /// <summary>
    /// 协议消息
    /// </summary>
    public class ProtocolMessage
    {
        public ProtocolHeader Header { get; set; } = new ProtocolHeader();
        public int? ErrorCode { get; set; }
        public int? Sequence { get; set; }
        public int? EventId { get; set; }
        public string? SessionId { get; set; }
        public byte[] Payload { get; set; } = Array.Empty<byte>();

        /// <summary>
        /// 将消息编码为字节数组
        /// </summary>
        public byte[] Encode()
        {
            using var ms = new MemoryStream();
            
            // 写入Header
            ms.Write(Header.ToBytes(), 0, 4);

            // 根据flags写入可选字段
            byte flags = Header.MessageTypeSpecificFlags;

            // 错误码（仅错误数据包）
            if (Header.MessageType == MessageType.ErrorInformation)
            {
                if (ErrorCode.HasValue)
                {
                    ms.Write(BitConverter.GetBytes(ErrorCode.Value), 0, 4);
                }
            }

            // Sequence
            if ((flags & 0b0011) != 0 && Sequence.HasValue)
            {
                ms.Write(BitConverter.GetBytes(Sequence.Value), 0, 4);
            }

            // Event ID
            if ((flags & MessageFlags.HasEventId) != 0 && EventId.HasValue)
            {
                // Event ID (4 bytes, big endian)
                ms.Write(ByteOrder.GetBytesBigEndian(EventId.Value), 0, 4);

                // Session ID (仅当SessionId不为空时传递)
                if (!string.IsNullOrEmpty(SessionId))
                {
                    byte[] sessionIdBytes = Encoding.UTF8.GetBytes(SessionId);
                    // Session ID size (4 bytes, big endian) + Session ID
                    ms.Write(ByteOrder.GetBytesBigEndian(sessionIdBytes.Length), 0, 4);
                    ms.Write(sessionIdBytes, 0, sessionIdBytes.Length);
                }
            }

            // Payload size (4 bytes, big endian) 和 payload
            ms.Write(ByteOrder.GetBytesBigEndian(Payload.Length), 0, 4);
            if (Payload.Length > 0)
            {
                ms.Write(Payload, 0, Payload.Length);
            }

            return ms.ToArray();
        }

        /// <summary>
        /// 从字节数组解码消息
        /// </summary>
        public static ProtocolMessage Decode(byte[] data)
        {
            if (data.Length < 4)
                throw new ArgumentException("Data too short for header");

            var message = new ProtocolMessage();
            message.Header = ProtocolHeader.FromBytes(data);
            
            int offset = 4;
            byte flags = message.Header.MessageTypeSpecificFlags;

            // 错误码 (big endian)
            if (message.Header.MessageType == MessageType.ErrorInformation)
            {
                if (data.Length >= offset + 4)
                {
                    message.ErrorCode = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(offset));
                    offset += 4;
                }
            }

            // Sequence (big endian)
            if ((flags & 0b0011) != 0 && data.Length >= offset + 4)
            {
                message.Sequence = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(offset));
                offset += 4;
            }

            // Event ID (big endian)
            if ((flags & MessageFlags.HasEventId) != 0 && data.Length >= offset + 4)
            {
                message.EventId = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(offset));
                offset += 4;

                // Session ID (如果还有足够的数据)
                if (data.Length >= offset + 4)
                {
                    int sessionIdSize = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(offset));
                    offset += 4;
                    if (data.Length >= offset + sessionIdSize && sessionIdSize > 0)
                    {
                        message.SessionId = Encoding.UTF8.GetString(data, offset, sessionIdSize);
                        offset += sessionIdSize;
                    }
                }
            }

            // Payload
            if (data.Length >= offset + 4)
            {
                int payloadSize = BinaryPrimitives.ReadInt32BigEndian(data.AsSpan(offset));
                offset += 4;
                if (data.Length >= offset + payloadSize && payloadSize > 0)
                {
                    message.Payload = new byte[payloadSize];
                    Buffer.BlockCopy(data, offset, message.Payload, 0, payloadSize);
                }
            }

            return message;
        }

        /// <summary>
        /// 创建客户端文本事件消息
        /// </summary>
        public static ProtocolMessage CreateClientEvent(ClientEventId eventId, string? sessionId = null, string? jsonPayload = null)
        {
            var message = new ProtocolMessage();
            message.Header = new ProtocolHeader
            {
                MessageType = MessageType.FullClientRequest,
                MessageTypeSpecificFlags = MessageFlags.HasEventId,
                SerializationMethod = SerializationMethod.Json
            };
            message.EventId = (int)eventId;
            message.SessionId = sessionId;
            message.Payload = string.IsNullOrEmpty(jsonPayload) ? 
                Encoding.UTF8.GetBytes("{}") : 
                Encoding.UTF8.GetBytes(jsonPayload);
            return message;
        }

        /// <summary>
        /// 创建音频数据消息
        /// </summary>
        public static ProtocolMessage CreateAudioRequest(string sessionId, byte[] audioData)
        {
            var message = new ProtocolMessage();
            message.Header = new ProtocolHeader
            {
                MessageType = MessageType.AudioOnlyRequest,
                MessageTypeSpecificFlags = MessageFlags.HasEventId,
                SerializationMethod = SerializationMethod.Raw
            };
            message.EventId = (int)ClientEventId.TaskRequest;
            message.SessionId = sessionId;
            message.Payload = audioData;
            return message;
        }
    }
}
