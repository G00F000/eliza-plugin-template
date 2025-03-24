import * as WebSocket from 'ws';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { URLSearchParams } from 'url';

// 配置参数
const config = {
    hostUrl: 'wss://iat-api.xf-yun.com/v1',
    appid: 'b03d6016',
    apiSecret: 'MGRkZTUyN2I4NWQ4NDViNjQ5MmEwMWNi',
    apiKey: '83983a167b76709c9d1611057073d831',
    filePath: './resource/iat/16k_10.pcm'
};

// 状态常量
enum Status {
    FirstFrame = 0,
    ContinueFrame = 1,
    LastFrame = 2
}

// WebSocket客户端封装
class IATClient {
    private ws: WebSocket;
    private totalResult: string[] = [];

    constructor(url: string) {
        this.ws = new WebSocket(url);
        this.setupListeners();
    }

    private setupListeners() {
        this.ws.on('open', () => this.handleOpen());
        this.ws.on('message', (data) => this.handleMessage(data));
        this.ws.on('close', () => this.handleClose());
        this.ws.on('error', (err) => this.handleError(err));
    }

    private handleOpen() {
        console.log('WebSocket connection opened');
        this.sendAudioFrames();
    }

    private handleMessage(data: WebSocket.Data) {
        const response = JSON.parse(data.toString());
        if (response.header.code !== 0) {
            console.error('Error:', response.header);
            return;
        }

        if (response.payload?.result) {
            const text = Buffer.from(response.payload.result.text, 'base64').toString();
            const result = JSON.parse(text);
            this.totalResult.push(result.text);
            console.log('Partial Result:', result.text);
        }

        if (response.header.status === 2) {
            console.log('\nFinal Result:', this.totalResult.join(''));
            this.ws.close();
        }
    }

    private async sendAudioFrames() {
        const frameSize = 1280;
        let status = Status.FirstFrame;
        let seq = 0;

        try {
            const stream = fs.createReadStream(config.filePath, { highWaterMark: frameSize });

            for await (const chunk of stream) {
                seq++;
                const payload = {
                    header: {
                        app_id: config.appid,
                        status: status
                    },
                    parameter: {
                        iat: {
                            domain: "slm",
                            language: "zh_cn",
                            accent: "mandarin",
                            eos: 6000,
                            dwa: "wpgs",
                            result: {
                                encoding: "utf8",
                                compress: "raw",
                                format: "json"
                            }
                        }
                    },
                    payload: {
                        audio: {
                            encoding: "raw",
                            sample_rate: 16000,
                            channels: 1,
                            bit_depth: 16,
                            seq: seq,
                            status: status,
                            audio: chunk.toString('base64')
                        }
                    }
                };

                this.ws.send(JSON.stringify(payload));
                status = Status.ContinueFrame;
                await new Promise(resolve => setTimeout(resolve, 40));
            }

            // 发送结束帧
            status = Status.LastFrame;
            this.ws.send(JSON.stringify({
                header: { status: status }
            }));

        } catch (err) {
            console.error('File read error:', err);
            this.ws.close();
        }
    }

    private handleClose() {
        console.log('WebSocket connection closed');
    }

    private handleError(err: Error) {
        console.error('WebSocket error:', err);
    }
}

// 鉴权URL生成
function createAuthUrl(): string {
    const date = new Date().toUTCString();
    const signatureOrigin = `host: iat-api.xf-yun.com\ndate: ${date}\nGET /v1 HTTP/1.1`;

    const hmac = crypto.createHmac('sha256', config.apiSecret);
    hmac.update(signatureOrigin);
    const signature = hmac.digest('base64');

    const params = new URLSearchParams({
        host: 'iat-api.xf-yun.com',
        date: date,
        authorization: `api_key="${config.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
    });

    return `${config.hostUrl}?${params.toString()}`;
}

// 主执行流程
(async () => {
    try {
        const authUrl = createAuthUrl();
        new IATClient(authUrl);
    } catch (err) {
        console.error('Initialization failed:', err);
    }
})();