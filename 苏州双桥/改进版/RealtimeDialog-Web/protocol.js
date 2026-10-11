/**
 * 字节序转换辅助函数
 */
export class ByteOrder {
    /**
     * 将int转换为大端序字节数组
     * @param {number} value 
     * @returns {Uint8Array}
     */
    static getBytesBigEndian(value) {
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        view.setInt32(0, value, false); // false = big endian
        return new Uint8Array(buffer);
    }
    
    /**
     * 从大端序字节数组读取int
     * @param {Uint8Array} bytes 
     * @param {number} offset 
     * @returns {number}
     */
    static readInt32BigEndian(bytes, offset = 0) {
        const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
        return view.getInt32(0, false); // false = big endian
    }
}

/**
 * 消息类型
 */
export const MessageType = {
    /** 客户端发送文本事件 */
    FullClientRequest: 0b0001,
    
    /** 服务器返回的文本事件 */
    FullServerResponse: 0b1001,
    
    /** 客户端发送音频数据 */
    AudioOnlyRequest: 0b0010,
    
    /** 服务器返回音频数据 */
    AudioOnlyResponse: 0b1011,
    
    /** 服务器返回的错误事件 */
    ErrorInformation: 0b1111
};

/**
 * 序列化方法
 */
export const SerializationMethod = {
    /** 无特殊序列化（二进制音频数据） */
    Raw: 0b0000,
    
    /** JSON（文本类型消息） */
    Json: 0b0001
};

/**
 * 压缩方法
 */
export const CompressionMethod = {
    /** 无压缩 */
    None: 0b0000,
    
    /** gzip压缩 */
    Gzip: 0b0001
};

/**
 * 客户端事件ID
 */
export const ClientEventId = {
    StartConnection: 1,
    FinishConnection: 2,
    StartSession: 100,
    FinishSession: 102,
    TaskRequest: 200,
    UpdateConfig: 201,
    SayHello: 300,
    EndASR: 400,
    ChatTTSText: 500,
    ChatTextQuery: 501,
    ChatRAGText: 502,
    ConversationCreate: 510,
    ConversationUpdate: 511,
    ConversationRetrieve: 512,
    ConversationTruncate: 513,
    ConversationDelete: 514,
    ClientInterrupt: 515
};

/**
 * 服务端事件ID
 */
export const ServerEventId = {
    ConnectionStarted: 50,
    ConnectionFailed: 51,
    ConnectionFinished: 52,
    SessionStarted: 150,
    SessionFinished: 152,
    SessionFailed: 153,
    UsageResponse: 154,
    ConfigUpdated: 251,
    TTSSentenceStart: 350,
    TTSSentenceEnd: 351,
    TTSResponse: 352,
    TTSEnded: 359,
    ASRInfo: 450,
    ASRResponse: 451,
    ASREnded: 459,
    ChatResponse: 550,
    ChatTextQueryConfirmed: 553,
    ChatEnded: 559,
    ConversationCreated: 567,
    ConversationUpdated: 568,
    ConversationRetrieved: 569,
    ConversationTruncated: 570,
    ConversationDeleted: 571,
    DialogCommonError: 599
};

/**
 * 可选字段标志位
 */
export const MessageFlags = {
    /** 没有sequence字段 */
    NoSequence: 0b0000,
    
    /** 序号大于0的非终端数据包 */
    SequenceNonTerminal: 0b0001,
    
    /** 最后一个无序号的数据包 */
    LastNoSequence: 0b0010,
    
    /** 最后一个序号小于0的数据包（一般用-1表示） */
    LastNegativeSequence: 0b0011,
    
    /** 携带事件ID */
    HasEventId: 0b0100
};

/**
 * 协议头
 */
export class ProtocolHeader {
    constructor() {
        this.protocolVersion = 0b0001;  // v1
        this.headerSize = 0b0001;       // 4字节
        this.messageType = MessageType.FullClientRequest;
        this.messageTypeSpecificFlags = 0;
        this.serializationMethod = SerializationMethod.Json;
        this.compressionMethod = CompressionMethod.None;
        this.reserved = 0x00;
    }
    
    /**
     * 将头部转换为字节数组
     * @returns {Uint8Array}
     */
    toBytes() {
        const bytes = new Uint8Array(4);
        bytes[0] = (this.protocolVersion << 4) | this.headerSize;
        bytes[1] = (this.messageType << 4) | this.messageTypeSpecificFlags;
        bytes[2] = (this.serializationMethod << 4) | this.compressionMethod;
        bytes[3] = this.reserved;
        return bytes;
    }
    
    /**
     * 从字节数组解析头部
     * @param {Uint8Array} bytes 
     * @returns {ProtocolHeader}
     */
    static fromBytes(bytes) {
        const header = new ProtocolHeader();
        header.protocolVersion = (bytes[0] >> 4) & 0x0F;
        header.headerSize = bytes[0] & 0x0F;
        header.messageType = (bytes[1] >> 4) & 0x0F;
        header.messageTypeSpecificFlags = bytes[1] & 0x0F;
        header.serializationMethod = (bytes[2] >> 4) & 0x0F;
        header.compressionMethod = bytes[2] & 0x0F;
        header.reserved = bytes[3];
        return header;
    }
}

/**
 * 协议消息
 */
export class ProtocolMessage {
    constructor() {
        this.header = new ProtocolHeader();
        this.errorCode = null;
        this.sequence = null;
        this.eventId = null;
        this.sessionId = null;
        this.payload = new Uint8Array(0);
    }
    
    /**
     * 将消息编码为字节数组
     * @returns {Uint8Array}
     */
    encode() {
        const parts = [];
        
        // 写入Header
        parts.push(this.header.toBytes());
        
        const flags = this.header.messageTypeSpecificFlags;
        
        // 错误码（仅错误数据包）
        if (this.header.messageType === MessageType.ErrorInformation) {
            if (this.errorCode !== null) {
                parts.push(ByteOrder.getBytesBigEndian(this.errorCode));
            }
        }
        
        // Sequence
        if ((flags & 0b0011) !== 0 && this.sequence !== null) {
            parts.push(ByteOrder.getBytesBigEndian(this.sequence));
        }
        
        // Event ID
        if ((flags & MessageFlags.HasEventId) !== 0 && this.eventId !== null) {
            // Event ID (4 bytes, big endian)
            parts.push(ByteOrder.getBytesBigEndian(this.eventId));
            
            // Session ID (仅当SessionId不为空时传递)
            if (this.sessionId) {
                const sessionIdBytes = new TextEncoder().encode(this.sessionId);
                // Session ID size (4 bytes, big endian) + Session ID
                parts.push(ByteOrder.getBytesBigEndian(sessionIdBytes.length));
                parts.push(sessionIdBytes);
            }
        }
        
        // Payload size (4 bytes, big endian) 和 payload
        parts.push(ByteOrder.getBytesBigEndian(this.payload.length));
        if (this.payload.length > 0) {
            parts.push(this.payload);
        }
        
        // 合并所有部分
        const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const part of parts) {
            result.set(part, offset);
            offset += part.length;
        }
        
        return result;
    }
    
    /**
     * 从字节数组解码消息
     * @param {Uint8Array} data 
     * @returns {ProtocolMessage}
     */
    static decode(data) {
        if (data.length < 4) {
            throw new Error('Data too short for header');
        }
        
        const message = new ProtocolMessage();
        message.header = ProtocolHeader.fromBytes(data);
        
        let offset = 4;
        const flags = message.header.messageTypeSpecificFlags;
        
        // 错误码 (big endian)
        if (message.header.messageType === MessageType.ErrorInformation) {
            if (data.length >= offset + 4) {
                message.errorCode = ByteOrder.readInt32BigEndian(data, offset);
                offset += 4;
            }
        }
        
        // Sequence (big endian)
        if ((flags & 0b0011) !== 0 && data.length >= offset + 4) {
            message.sequence = ByteOrder.readInt32BigEndian(data, offset);
            offset += 4;
        }
        
        // Event ID (big endian)
        if ((flags & MessageFlags.HasEventId) !== 0 && data.length >= offset + 4) {
            message.eventId = ByteOrder.readInt32BigEndian(data, offset);
            offset += 4;
            
            // Session ID (如果还有足够的数据)
            if (data.length >= offset + 4) {
                const sessionIdSize = ByteOrder.readInt32BigEndian(data, offset);
                offset += 4;
                if (data.length >= offset + sessionIdSize && sessionIdSize > 0) {
                    message.sessionId = new TextDecoder().decode(data.slice(offset, offset + sessionIdSize));
                    offset += sessionIdSize;
                }
            }
        }
        
        // Payload
        if (data.length >= offset + 4) {
            const payloadSize = ByteOrder.readInt32BigEndian(data, offset);
            offset += 4;
            if (data.length >= offset + payloadSize && payloadSize > 0) {
                message.payload = data.slice(offset, offset + payloadSize);
            }
        }
        
        return message;
    }
    
    /**
     * 创建客户端文本事件消息
     * @param {number} eventId 
     * @param {string|null} sessionId 
     * @param {string|null} jsonPayload 
     * @returns {ProtocolMessage}
     */
    static createClientEvent(eventId, sessionId = null, jsonPayload = null) {
        const message = new ProtocolMessage();
        message.header = new ProtocolHeader();
        message.header.messageType = MessageType.FullClientRequest;
        message.header.messageTypeSpecificFlags = MessageFlags.HasEventId;
        message.header.serializationMethod = SerializationMethod.Json;
        message.eventId = eventId;
        message.sessionId = sessionId;
        const payloadStr = jsonPayload || '{}';
        message.payload = new TextEncoder().encode(payloadStr);
        return message;
    }
    
    /**
     * 创建音频数据消息
     * @param {string} sessionId 
     * @param {Uint8Array} audioData 
     * @returns {ProtocolMessage}
     */
    static createAudioRequest(sessionId, audioData) {
        const message = new ProtocolMessage();
        message.header = new ProtocolHeader();
        message.header.messageType = MessageType.AudioOnlyRequest;
        message.header.messageTypeSpecificFlags = MessageFlags.HasEventId;
        message.header.serializationMethod = SerializationMethod.Raw;
        message.eventId = ClientEventId.TaskRequest;
        message.sessionId = sessionId;
        message.payload = audioData;
        return message;
    }
}
