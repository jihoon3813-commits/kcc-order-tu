/**
 * GAS Web App과 통신을 담당하는 모듈
 */

// ✅ 사용자가 GAS를 웹 앱으로 배포한 후 얻은 URL을 여기에 입력해야 합니다.
// 배포 시 '액세스 권한이 있는 사용자'를 '모든 사용자(Anyone)'로 설정해야 합니다.
export const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbykWmbvTcOz1V7RobkjcJavA2o_wgBZc4_nOBuhUQ_zuoFKv4Mz8njjefmn5p9yxuPy5w/exec';
export const GAS_URL = localStorage.getItem('GAS_URL') || DEFAULT_GAS_URL;

export async function serverCall(action, payload = {}) {
    // 1. Get URL and Passcode
    const storedUrl = localStorage.getItem('GAS_URL');
    const actualUrl = payload.gasUrl || storedUrl || DEFAULT_GAS_URL;
    const passcode = payload.passcode || localStorage.getItem('kcc_passcode');

    if (!actualUrl || !actualUrl.startsWith('https://script.google.com')) {
        throw new Error('유효한 GAS Web App URL이 없습니다.');
    }

    // 2. Prepare Body
    const body = JSON.stringify({
        action,
        payload,
        passcode
    });

    try {
        // GAS Web App does NOT support standard CORS for all Content-Types.
        // Sending as a simple request (text/plain) skips the OPTIONS preflight.
        const response = await fetch(actualUrl, {
            method: 'POST',
            mode: 'cors',
            redirect: 'follow',
            body: body,
            headers: {
                'Content-Type': 'text/plain;charset=utf-8'
            }
        });

        if (!response.ok) {
            throw new Error(`연결 실패 (Status: ${response.status})`);
        }

        const data = await response.json();
        if (data && data.ok === false) {
            throw new Error(data.msg || '요청 처리에 실패했습니다.');
        }
        return data;

    } catch (err) {
        console.error('GAS API Error:', err);
        // Common GAS error handling
        if (err.name === 'SyntaxError') {
            throw new Error('서버 응답이 JSON 형식이 아닙니다. GAS 배포 시 "모든 사용자(Anyone)" 권한을 주었는지 확인하세요.');
        }
        throw new Error(`GAS 서버 연결 실패: ${err.message}`);
    }
}
