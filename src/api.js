/**
 * GAS Web App과 통신을 담당하는 모듈
 */

// ✅ 사용자가 GAS를 웹 앱으로 배포한 후 얻은 URL을 여기에 입력해야 합니다.
// 배포 시 '액세스 권한이 있는 사용자'를 '모든 사용자(Anyone)'로 설정해야 합니다.
export const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbxNlxTadMHC5-tDb1ehrxUEIpyN3HG5zsbRZC0vj73NqinNqAAm1mS2PPjQGhOduhxT3g/exec';
export const GAS_URL = localStorage.getItem('GAS_URL') || DEFAULT_GAS_URL;

export async function callApi(action, payload = {}) {
    const url = localStorage.getItem('GAS_URL');
    if (!url) {
        throw new Error('GAS Web App URL이 설정되지 않았습니다. 설정에서 먼저 설정해주세요.');
    }

    const passcode = localStorage.getItem('kcc_passcode');

    try {
        const response = await fetch(url, {
            method: 'POST',
            mode: 'no-cors', // GAS의 특성상 no-cors로 보내거나, 리디렉션을 처리해야 함
            // 하지만 no-cors는 응답을 읽을 수 없음. 
            // GAS는 302 리디렉션을 사용하므로, 브라우저 fetch는 이를 자동으로 따라감.
            // 실제로는 mode: 'cors'가 표준이지만 GAS는 CORS 헤더를 직접 제어하기 어려움.
            // 다행히 ContentService 응답은 브라우저에서 읽을 수 있게 처리되는 경우가 많음.
        });

        // GAS fetch의 정석 (CORS 대응)
        const res = await fetch(url, {
            method: 'POST',
            body: JSON.stringify({
                action,
                payload,
                passcode
            })
        });

        if (!res.ok) throw new Error('네트워크 응답이 올바르지 않습니다.');
        return await res.json();
    } catch (error) {
        console.error('API Call Error:', error);
        throw error;
    }
}

/**
 * GAS 특유의 리디렉션과 CORS 이슈를 해결한 fetch wrapper
 */
export async function serverCall(action, payload = {}) {
    const url = localStorage.getItem('GAS_URL');
    if (!url && action !== 'checkLogin') {
        throw new Error('GAS_URL이 없습니다.');
    }

    const actualUrl = url || payload.gasUrl; // 로그인 시에는 입력받은 URL 사용
    const passcode = localStorage.getItem('kcc_passcode') || payload.passcode;

    return new Promise((resolve, reject) => {
        // GAS Web App은 POST 요청 시 302 리디렉션을 발생시키며, 
        // fetch는 이를 자동으로 처리하지만 CORS 정책에 따라 차단될 수 있습니다.
        // 하지만 ContentService.createTextOutput().setMimeType(JSON)은 
        // 최근 브라우저에서 비교적 잘 작동합니다.

        fetch(actualUrl, {
            method: 'POST',
            body: JSON.stringify({
                action,
                payload,
                passcode
            })
        })
            .then(response => response.json())
            .then(data => {
                if (data && data.ok === false) {
                    reject(new Error(data.msg || '요청 실패'));
                } else {
                    resolve(data);
                }
            })
            .catch(err => {
                console.error('Fetch Error:', err);
                reject(new Error("GAS 서버 연결 실패. URL이 올바른지, 혹은 'Anyone' 권한으로 배포되었는지 확인하세요."));
            });
    });
}
