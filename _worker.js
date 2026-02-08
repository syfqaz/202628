import {connect} from 'cloudflare:sockets';
import wasmModule from './protocol.wasm';

const uuid = '7342d11e-d424-4683-b36e-124ab1f0afa4';
const passWordSha224 = '17018107b171fc75130abbea6df2f5690015fbe4b10ac7964952c80d';
const socks5AndHttpUser = 'admin';   
const socks5AndHttpPass = '123456';   
const bufferSize = 512 * 1024;         // 512KB

const startThreshold = 50 * 1024 * 1024; //50MB

const maxChunkLen = 64 * 1024;        // 64KB

const flushTime = 20;                 // 20ms

const concurrentOnlyDomain = false;//只对域名并发开关

let concurrency = 4;//socket获取并发数

const proxyStrategyOrder = ['socks', 'http', 'nat64'];
const dohEndpoints = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/dns-query'];
const dohNatEndpoints = ['https://cloudflare-dns.com/dns-query', 'https://dns.google/resolve'];
const proxyIpAddrs = {EU: 'ProxyIP.DE.CMLiussss.net', AS: 'ProxyIP.SG.CMLiussss.net', JP: 'ProxyIP.JP.CMLiussss.net', US: 'ProxyIP.US.CMLiussss.net'};//分区域proxyip
const finallyProxyHost = 'ProxyIP.CMLiussss.net';
const coloRegions = {
    JP: new Set(['FUK', 'ICN', 'KIX', 'NRT', 'OKA']),
    EU: new Set([
        'ACC', 'ADB', 'ALA', 'ALG', 'AMM', 'AMS', 'ARN', 'ATH', 'BAH', 'BCN', 'BEG', 'BGW', 'BOD', 'BRU', 'BTS', 'BUD', 'CAI',
        'CDG', 'CPH', 'CPT', 'DAR', 'DKR', 'DMM', 'DOH', 'DUB', 'DUR', 'DUS', 'DXB', 'EBB', 'EDI', 'EVN', 'FCO', 'FRA', 'GOT',
        'GVA', 'HAM', 'HEL', 'HRE', 'IST', 'JED', 'JIB', 'JNB', 'KBP', 'KEF', 'KWI', 'LAD', 'LED', 'LHR', 'LIS', 'LOS', 'LUX',
        'LYS', 'MAD', 'MAN', 'MCT', 'MPM', 'MRS', 'MUC', 'MXP', 'NBO', 'OSL', 'OTP', 'PMO', 'PRG', 'RIX', 'RUH', 'RUN', 'SKG',
        'SOF', 'STR', 'TBS', 'TLL', 'TLV', 'TUN', 'VIE', 'VNO', 'WAW', 'ZAG', 'ZRH']),
    AS: new Set([
        'ADL', 'AKL', 'AMD', 'BKK', 'BLR', 'BNE', 'BOM', 'CBR', 'CCU', 'CEB', 'CGK', 'CMB', 'COK', 'DAC', 'DEL', 'HAN', 'HKG',
        'HYD', 'ISB', 'JHB', 'JOG', 'KCH', 'KHH', 'KHI', 'KTM', 'KUL', 'LHE', 'MAA', 'MEL', 'MFM', 'MLE', 'MNL', 'NAG', 'NOU',
        'PAT', 'PBH', 'PER', 'PNH', 'SGN', 'SIN', 'SYD', 'TPE', 'ULN', 'VTE'])
};
const coloToProxyMap = new Map();
for (const [region, colos] of Object.entries(coloRegions)) {for (const colo of colos) coloToProxyMap.set(colo, proxyIpAddrs[region])}
const uuidBytes = new Uint8Array(16), hashBytes = new Uint8Array(56), offsets = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4, 4, 4];
for (let i = 0, c; i < 16; i++) uuidBytes[i] = (((c = uuid.charCodeAt(i * 2 + offsets[i])) > 64 ? c + 9 : c) & 0xF) << 4 | (((c = uuid.charCodeAt(i * 2 + offsets[i] + 1)) > 64 ? c + 9 : c) & 0xF);
for (let i = 0; i < 56; i++) hashBytes[i] = passWordSha224.charCodeAt(i);
const [textEncoder, textDecoder, socks5Init, socks5req] = [new TextEncoder(), new TextDecoder(), new Uint8Array([5, 2, 0, 2]), new Uint8Array([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])];
let socks5Pkg, httpAuthValue;
const httpRes200 = textEncoder.encode("HTTP/1.1 200 Connection Established\r\n\r\n"), httpRes407 = textEncoder.encode("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"proxy\"\r\n\r\n");
if (socks5AndHttpUser && socks5AndHttpPass) {
    httpAuthValue = textEncoder.encode(btoa(`${socks5AndHttpUser}:${socks5AndHttpPass}`));
    const userBytes = textEncoder.encode(socks5AndHttpUser), passBytes = textEncoder.encode(socks5AndHttpPass);
    socks5Pkg = new Uint8Array(3 + userBytes.length + passBytes.length);
    socks5Pkg[0] = 1, socks5Pkg[1] = userBytes.length, socks5Pkg.set(userBytes, 2), socks5Pkg[2 + userBytes.length] = passBytes.length, socks5Pkg.set(passBytes, 3 + userBytes.length);
}
const html = `<body style=margin:0;overflow:hidden;background:#000><canvas id=c style=width:100vw;height:100vh><script>var C=document.getElementById("c"),g=C.getContext("webgl"),t=0,P,R,F,U,O,X,Y,L,T,b=.4,K="float L(vec3 v){vec3 a=v;float b,c,d;for(int i=0;i<5;i++){b=length(a);c=atan(a.y,a.x)*10.;d=acos(a.z/b)*10.;b=pow(b,8.);a=vec3(b*sin(d)*cos(c),b*sin(d)*sin(c),b*cos(d))+v;if(b>6.)break;}return 4.-dot(a,a);}",VS="attribute vec4 p;varying vec3 d,ld;uniform vec3 r,f,u;uniform float x,y;void main(){gl_Position=p;d=f+r*p.x*x+u*p.y*y;ld=vec3(p.x*x,p.y*y,-1.);}",FS="precision highp float;float L(vec3 v);uniform vec3 r,f,u,o;uniform float t;varying vec3 d,ld;uniform float l;void main(){vec3 tc=vec3(0);for(int i=0;i<4;i++){vec2 of=vec2(mod(float(i),2.),floor(float(i)/2.))*.5;vec3 rd=normalize(d+r*of.x*.001+u*of.y*.001),c=vec3(0);float s=.002*l,r1,r2,r3;for(int k=2;k<1200;k++){float ds=s*float(k);vec3 p=o+rd*ds;if(L(p)>0.){r1=s*float(k-1);r2=ds;for(int j=0;j<24;j++){r3=(r1+r2)*.5;if(L(o+rd*r3)>0.)r2=r3;else r1=r3;}vec3 v=o+rd*r3,nw;float e=r3*1e-4;nw=normalize(vec3(L(v-r*e)-L(v+r*e),L(v-u*e)-L(v+u*e),L(v+f*e)-L(v-f*e)));vec3 rf=reflect(normalize(ld),nw);float d2=dot(v,v),lt=pow(max(0.,dot(rf,vec3(.276,.92,.276))),4.)*.45+max(0.,dot(nw,vec3(.276,.92,.276)))*.25+.3;c=(sin(d2*5.+t+vec3(0,2,4))*.5+.5)*lt;break;}}tc+=c;}gl_FragColor=vec4(pow(tc*.25,vec3(.7)),1);}";function i(){var s=g.createProgram(),v=g.createShader(35633),f=g.createShader(35632);g.shaderSource(v,VS),g.compileShader(v),g.shaderSource(f,FS+K),g.compileShader(f),g.attachShader(s,v),g.attachShader(s,f),g.linkProgram(s),g.useProgram(s),P=g.getAttribLocation(s,"p"),R=g.getUniformLocation(s,"r"),F=g.getUniformLocation(s,"f"),U=g.getUniformLocation(s,"u"),O=g.getUniformLocation(s,"o"),X=g.getUniformLocation(s,"x"),Y=g.getUniformLocation(s,"y"),L=g.getUniformLocation(s,"l"),T=g.getUniformLocation(s,"t"),g.bindBuffer(34962,g.createBuffer()),g.bufferData(34962,new Float32Array([-1,-1,0,1,-1,0,1,1,0,-1,-1,0,1,1,0,-1,1,0]),35044),g.vertexAttribPointer(P,3,5126,!1,0,0),g.enableVertexAttribArray(P)}function w(){t+=.02,innerWidth*devicePixelRatio!=C.width&&(C.width=innerWidth*(d=devicePixelRatio||1),C.height=innerHeight*d,g.viewport(0,0,C.width,C.height));var v=C.width/C.height;g.uniform1f(X,v>1?v:1),g.uniform1f(Y,v>1?1:1/v),g.uniform1f(L,1.6),g.uniform1f(T,t),g.uniform3f(O,1.6*Math.cos(t*.5)*Math.cos(b),1.6*Math.sin(b),1.6*Math.sin(t*.5)*Math.cos(b)),g.uniform3f(R,Math.sin(t*.5),0,-Math.cos(t*.5)),g.uniform3f(U,-Math.sin(b)*Math.cos(t*.5),Math.cos(b),-Math.sin(b)*Math.sin(t*.5)),g.uniform3f(F,-Math.cos(t*.5)*Math.cos(b),-Math.sin(b),-Math.sin(t*.5)*Math.cos(b)),g.drawArrays(4,0,6),requestAnimationFrame(w)}i(),w()</script>`;
const binaryAddrToString = (addrType, addrBytes) => {
    if (addrType === 3) return textDecoder.decode(addrBytes);
    if (addrType === 1) return `${addrBytes[0]}.${addrBytes[1]}.${addrBytes[2]}.${addrBytes[3]}`;
    let ipv6 = ((addrBytes[0] << 8) | addrBytes[1]).toString(16);
    for (let i = 1; i < 8; i++) ipv6 += ':' + ((addrBytes[i * 2] << 8) | addrBytes[i * 2 + 1]).toString(16);
    return `[${ipv6}]`;
};
const parseHostPort = (addr, defaultPort) => {
    if (addr.charCodeAt(0) === 91) {
        const sepIndex = addr.indexOf(']:');
        if (sepIndex !== -1) return [addr.substring(0, sepIndex + 1), addr.substring(sepIndex + 2)];
        return [addr, defaultPort];
    }
    const tpIndex = addr.indexOf('.tp');
    const lastColon = addr.lastIndexOf(':');
    if (tpIndex !== -1 && lastColon === -1) return [addr, addr.substring(tpIndex + 3, addr.indexOf('.', tpIndex + 3))];
    if (lastColon === -1) return [addr, defaultPort];
    return [addr.substring(0, lastColon), addr.substring(lastColon + 1)];
};
const parseAuthString = (authParam) => {
    let username, password, hostStr;
    const atIndex = authParam.lastIndexOf('@');
    if (atIndex === -1) {hostStr = authParam} else {
        const cred = authParam.substring(0, atIndex);
        hostStr = authParam.substring(atIndex + 1);
        const colonIndex = cred.indexOf(':');
        if (colonIndex === -1) {username = cred} else {
            username = cred.substring(0, colonIndex);
            password = cred.substring(colonIndex + 1);
        }
    }
    const [hostname, port] = parseHostPort(hostStr, 1080);
    return {username, password, hostname, port};
};
const isIPv4 = (str) => {
    const len = str.length;
    if (len > 15 || len < 7) return false;
    let part = 0, dots = 0, partLen = 0, head = 0;
    for (let i = 0; i < len; i++) {
        const charCode = str.charCodeAt(i);
        if (charCode === 46) {
            if (dots === 3 || partLen === 0 || (partLen > 1 && head === 48)) return false;
            dots++, part = 0, partLen = 0;
        } else {
            const digit = (charCode - 48) >>> 0;
            if (digit > 9) return false;
            if (partLen === 0) head = charCode;
            partLen++, part = part * 10 + digit;
            if (part > 255 || partLen > 3) return false;
        }
    }
    return dots === 3 && partLen > 0 && !(partLen > 1 && head === 48);
};
const isDomainName = (str) => {
    if (!concurrentOnlyDomain) return true;
    const firstCode = str.charCodeAt(0);
    if ((firstCode - 48) >>> 0 > 9) return firstCode !== 91;
    return !isIPv4(str);
};
const createConnect = (hostname, port, socket = connect({hostname, port})) => socket.opened.then(() => socket);
const concurrentConnect = (hostname, port, addrType, limit = concurrency) => {
    if (limit === 1 || (concurrentOnlyDomain && addrType !== 3)) return createConnect(hostname, port);
    return Promise.any(Array(limit).fill(null).map(() => createConnect(hostname, port)));
};
const connectViaSocksProxy = async (targetAddrType, targetPortNum, socksAuth, addrBytes, limit) => {
    const addrType = isDomainName(socksAuth.hostname) ? 3 : 0;
    const socksSocket = await concurrentConnect(socksAuth.hostname, socksAuth.port, addrType, limit);
    const writer = socksSocket.writable.getWriter();
    const reader = socksSocket.readable.getReader();
    await writer.write(socks5Init);
    const {value: authResponse} = await reader.read();
    if (!authResponse || authResponse[0] !== 5 || authResponse[1] === 0xFF) return null;
    if (authResponse[1] === 2) {
        if (!socksAuth.username) return null;
        const userBytes = textEncoder.encode(socksAuth.username);
        const passBytes = textEncoder.encode(socksAuth.password || '');
        const uLen = userBytes.length, pLen = passBytes.length, authReq = new Uint8Array(3 + uLen + pLen)
        authReq[0] = 1, authReq[1] = uLen, authReq.set(userBytes, 2), authReq[2 + uLen] = pLen, authReq.set(passBytes, 3 + uLen);
        await writer.write(authReq);
        const {value: authResult} = await reader.read();
        if (!authResult || authResult[0] !== 1 || authResult[1] !== 0) return null;
    } else if (authResponse[1] !== 0) {return null}
    const isDomain = targetAddrType === 3, socksReq = new Uint8Array(6 + addrBytes.length + (isDomain ? 1 : 0));
    socksReq[0] = 5, socksReq[1] = 1, socksReq[2] = 0, socksReq[3] = targetAddrType;
    isDomain ? (socksReq[4] = addrBytes.length, socksReq.set(addrBytes, 5)) : socksReq.set(addrBytes, 4);
    socksReq[socksReq.length - 2] = targetPortNum >> 8, socksReq[socksReq.length - 1] = targetPortNum & 0xff;
    await writer.write(socksReq);
    const {value: finalResponse} = await reader.read();
    if (!finalResponse || finalResponse[1] !== 0) return null;
    writer.releaseLock(), reader.releaseLock();
    return socksSocket;
};
const staticHeaders = `User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36\r\nProxy-Connection: Keep-Alive\r\nConnection: Keep-Alive\r\n\r\n`;
const encodedStaticHeaders = textEncoder.encode(staticHeaders);
const connectViaHttpProxy = async (targetAddrType, targetPortNum, httpAuth, addrBytes, limit) => {
    const {username, password, hostname, port} = httpAuth;
    const addrType = isDomainName(hostname) ? 3 : 0;
    const proxySocket = await concurrentConnect(hostname, port, addrType, limit);
    const writer = proxySocket.writable.getWriter();
    const httpHost = binaryAddrToString(targetAddrType, addrBytes);
    let dynamicHeaders = `CONNECT ${httpHost}:${targetPortNum} HTTP/1.1\r\nHost: ${httpHost}:${targetPortNum}\r\n`;
    if (username) dynamicHeaders += `Proxy-Authorization: Basic ${btoa(`${username}:${password || ''}`)}\r\n`;
    const fullHeaders = new Uint8Array(dynamicHeaders.length * 3 + encodedStaticHeaders.length);
    const {written} = textEncoder.encodeInto(dynamicHeaders, fullHeaders);
    fullHeaders.set(encodedStaticHeaders, written);
    await writer.write(fullHeaders.subarray(0, written + encodedStaticHeaders.length));
    writer.releaseLock();
    const reader = proxySocket.readable.getReader();
    const buffer = new Uint8Array(256);
    let bytesRead = 0, statusChecked = false;
    while (bytesRead < buffer.length) {
        const {value, done} = await reader.read();
        if (done || bytesRead + value.length > buffer.length) return null;
        const prevBytesRead = bytesRead;
        buffer.set(value, bytesRead);
        bytesRead += value.length;
        if (!statusChecked && bytesRead >= 12) {
            if (buffer[9] !== 50) return null;
            statusChecked = true;
        }
        let i = Math.max(15, prevBytesRead - 3);
        while ((i = buffer.indexOf(13, i)) !== -1 && i <= bytesRead - 4) {
            if (buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) {
                reader.releaseLock();
                if (bytesRead > i + 4) {
                    const {readable, writable} = new TransformStream();
                    const writer = writable.getWriter();
                    writer.write(buffer.subarray(i + 4, bytesRead));
                    writer.releaseLock();
                    proxySocket.readable.pipeTo(writable).catch(() => {});
                    // @ts-ignore
                    proxySocket.readable = readable;
                }
                return proxySocket;
            }
            i++;
        }
    }
    return null;
};
const instance = new WebAssembly.Instance(wasmModule, {env: {abort: () => {}}});
const {
    memory, getDataPtr, getSecretPtr, getResultPtr,
    parseRequestDataWasm, parseTransparentWasm, parseShadowWasm, parseSocks5Wasm, parseHttpWasm
} = instance.exports;
const rawMemory = new Uint8Array(memory.buffer);
const dataAddr = getDataPtr(), secretAddr = getSecretPtr(), resAddr = getResultPtr();
const wasmResView = new Int32Array(memory.buffer, resAddr, 9);
const prepareWasm = (chunk, secret = null) => {
    rawMemory.set(chunk, dataAddr);
    if (secret) rawMemory.set(secret, secretAddr);
};
const parseRequestData = (firstChunk) => {
    prepareWasm(firstChunk, uuidBytes);
    if (!parseRequestDataWasm(firstChunk.length)) return null;
    const r = wasmResView;
    return {addrType: r[0], port: r[1], dataOffset: r[2], isDns: r[3] === 1, addrBytes: firstChunk.subarray(r[7], r[7] + r[8])};
};
const parseTransparent = (firstChunk) => {
    prepareWasm(firstChunk, hashBytes);
    if (!parseTransparentWasm(firstChunk.length)) return null;
    const r = wasmResView;
    return {addrType: r[0], port: r[1], dataOffset: r[2], isDns: r[3] === 1, addrBytes: firstChunk.subarray(r[7], r[7] + r[8])};
};
const parseShadow = (firstChunk) => {
    prepareWasm(firstChunk);
    if (!parseShadowWasm(firstChunk.length)) return null;
    const r = wasmResView;
    return {addrType: r[0], port: r[1], dataOffset: r[2], isDns: r[3] === 1, addrBytes: firstChunk.subarray(r[7], r[7] + r[8])};
};
const parseSocks5 = (firstChunk) => {
    prepareWasm(firstChunk);
    if (!parseSocks5Wasm(firstChunk.length)) return null;
    const r = wasmResView;
    return {addrType: r[0], port: r[1], dataOffset: r[2], isSocks5: true, addrBytes: firstChunk.subarray(r[7], r[7] + r[8])};
};
const parseHttp = (firstChunk) => {
    prepareWasm(firstChunk, httpAuthValue || null);
    const ok = parseHttpWasm(firstChunk.length, !!httpAuthValue, httpAuthValue ? httpAuthValue.length : 0);
    const r = wasmResView;
    if (r[6] === 1) return {authFailed: true};
    if (!ok) return null;
    return {addrType: r[0], port: r[1], dataOffset: r[2], isHttp: true, addrBytes: firstChunk.subarray(r[7], r[7] + r[8])};
};
const ipv4ToNat64Ipv6 = (ipv4Address, nat64Prefixes) => {
    const parts = ipv4Address.split('.');
    let hexStr = "";
    for (let i = 0; i < 4; i++) {
        let h = (parts[i] | 0).toString(16);
        hexStr += (h.length === 1 ? "0" + h : h);
        if (i === 1) hexStr += ":";
    }
    return `[${nat64Prefixes}${hexStr}]`;
};
const dohJsonOptions = {headers: {'Accept': 'application/dns-json'}}, dohHeaders = {'content-type': 'application/dns-message'};
const concurrentDnsResolve = async (hostname, recordType) => {
    const dnsResult = await Promise.any(dohNatEndpoints.map(endpoint =>
        fetch(`${endpoint}?name=${hostname}&type=${recordType}`, dohJsonOptions).then(response => {
            if (!response.ok) throw new Error();
            return response.json();
        })
    ));
    const answer = dnsResult.Answer || dnsResult.answer;
    if (!answer || answer.length === 0) return null;
    return answer;
};
const dohDnsHandler = async (payload) => {
    if (payload.byteLength < 2) return null;
    const dnsQueryData = payload.subarray(2);
    const resp = await Promise.any(dohEndpoints.map(endpoint =>
        fetch(endpoint, {method: 'POST', headers: dohHeaders, body: dnsQueryData}).then(response => {
            if (!response.ok) throw new Error();
            return response;
        })
    ));
    const dnsQueryResult = await resp.arrayBuffer();
    const udpSize = dnsQueryResult.byteLength;
    const packet = new Uint8Array(2 + udpSize);
    packet[0] = (udpSize >> 8) & 0xff, packet[1] = udpSize & 0xff;
    packet.set(new Uint8Array(dnsQueryResult), 2);
    return packet;
};
const addrTypeIs = (hostname) => {
    const char0 = hostname.charCodeAt(0);
    return (char0 - 48) >>> 0 > 9 ? (char0 === 91 ? 4 : 3) : isIPv4(hostname) ? 1 : 3;
};
const connectNat64 = async (addrType, port, nat64Auth, addrBytes, proxyAll, limit, isHttp) => {
    const nat64Prefixes = nat64Auth.charCodeAt(0) === 91 ? nat64Auth.slice(1, -1) : nat64Auth;
    if (!proxyAll) return concurrentConnect(`[${nat64Prefixes}6815:3598]`, port, 4, limit);
    const hostname = binaryAddrToString(addrType, addrBytes);
    if (isHttp) addrType = addrTypeIs(hostname);
    if (addrType === 3) {
        const answer = await concurrentDnsResolve(hostname, 'A');
        const aRecord = answer?.find(record => record.type === 1);
        return aRecord ? concurrentConnect(ipv4ToNat64Ipv6(aRecord.data, nat64Prefixes), port, 4, limit) : null;
    }
    if (addrType === 1) return concurrentConnect(ipv4ToNat64Ipv6(hostname, nat64Prefixes), port, 4, limit);
    return concurrentConnect(hostname, port, 4, limit);
};
const williamResult = async (william) => {
    const answer = await concurrentDnsResolve(william, 'TXT');
    if (!answer) return null;
    let txtData, i = 0, len = answer.length;
    for (; i < len; i++) if (answer[i].type === 16) {
        txtData = answer[i].data;
        break;
    }
    if (!txtData) return null;
    if (txtData.charCodeAt(0) === 34 && txtData.charCodeAt(txtData.length - 1) === 34) txtData = txtData.slice(1, -1);
    const raw = txtData.split(/,|\\010|\n/), prefixes = [];
    for (i = 0, len = raw.length; i < len; i++) {
        const s = raw[i].trim();
        if (s) prefixes.push(s);
    }
    return prefixes.length ? prefixes : null;
};
const connectProxyIp = async (param, limit) => {
    if (param.includes('.william')) {
        const resolvedIps = await williamResult(param);
        if (!resolvedIps || resolvedIps.length === 0) return null;
        const connectionPromises = resolvedIps.map(ip => {
            const [host, port] = parseHostPort(ip, 443);
            return createConnect(host, port);
        });
        return await Promise.any(connectionPromises);
    }
    const [host, port] = parseHostPort(param, 443);
    const addrType = isDomainName(host) ? 3 : 0;
    return concurrentConnect(host, port, addrType, limit);
};
const strategyExecutorMap = new Map([
    [0, async ({addrType, port, addrBytes, isHttp}) => {
        const hostname = binaryAddrToString(addrType, addrBytes);
        if (isHttp && concurrentOnlyDomain) addrType = addrTypeIs(hostname);
        return concurrentConnect(hostname, port, addrType);
    }],
    [1, async ({addrType, port, addrBytes}, param, limit) => {
        const socksAuth = parseAuthString(param);
        return connectViaSocksProxy(addrType, port, socksAuth, addrBytes, limit);
    }],
    [2, async ({addrType, port, addrBytes}, param, limit) => {
        const httpAuth = parseAuthString(param);
        return connectViaHttpProxy(addrType, port, httpAuth, addrBytes, limit);
    }],
    [3, async (_parsedRequest, param, limit) => {
        return connectProxyIp(param, limit);
    }],
    [4, async ({addrType, port, addrBytes, isHttp}, param, limit) => {
        const {nat64Auth, proxyAll} = param;
        return connectNat64(addrType, port, nat64Auth, addrBytes, proxyAll, limit, isHttp);
    }]
]);
const paramRegex = /(gs5|s5all|ghttp|gnat64|nat64all|httpall|s5|socks|http|ip|nat64)(?:=|:\/\/|%3A%2F%2F)([^&]+)|(proxyall|globalproxy)/gi;
const establishTcpConnection = async (parsedRequest, request) => {
    let u = request.url, clean = u.slice(u.indexOf('/', 10) + 1, u.charCodeAt(u.length - 1) === 47 ? -1 : undefined), list = [];
    if (clean.length < 6) {list.push({type: 0}, {type: 3, param: coloToProxyMap.get(request.cf?.colo) ?? proxyIpAddrs.US}, {type: 3, param: finallyProxyHost})} else {
        paramRegex.lastIndex = 0;
        let m, p = Object.create(null);
        while ((m = paramRegex.exec(clean))) p[(m[1] || m[3]).toLowerCase()] = m[2] ? (m[2].charCodeAt(m[2].length - 1) === 61 ? m[2].slice(0, -1) : m[2]) : true;
        const s5 = p.gs5 || p.s5all || p.s5 || p.socks, http = p.ghttp || p.httpall || p.http, nat64 = p.gnat64 || p.nat64all || p.nat64;
        const proxyAll = !!(p.gs5 || p.s5all || p.ghttp || p.httpall || p.gnat64 || p.nat64all || p.proxyall || p.globalproxy);
        if (!proxyAll) list.push({type: 0});
        const add = (v, t) => {
            if (!v) return;
            const parts = decodeURIComponent(v).split(',').filter(Boolean);
            if (parts.length) list.push({type: t, param: parts.map(part => t === 4 ? {nat64Auth: part, proxyAll} : part), concurrent: true});
        };
        for (let i = 0; i < proxyStrategyOrder.length; i++) {
            const k = proxyStrategyOrder[i];
            add(k === 'socks' ? s5 : k === 'http' ? http : nat64, k === 'socks' ? 1 : k === 'http' ? 2 : 4);
        }
        if (proxyAll) {if (!list.length) list.push({type: 0})} else {
            add(p.ip, 3);
            list.push({type: 3, param: coloToProxyMap.get(request.cf?.colo) ?? proxyIpAddrs.US}, {type: 3, param: finallyProxyHost});
        }
    }
    for (let i = 0; i < list.length; i++) {
        try {
            const exec = strategyExecutorMap.get(list[i].type);
            const sub = (list[i]['concurrent'] && Array.isArray(list[i].param)) ? Math.max(1, Math.floor(concurrency / list[i].param.length)) : undefined;
            const socket = await (list[i]['concurrent'] && Array.isArray(list[i].param) ? Promise.any(list[i].param.map(ip => exec(parsedRequest, ip, sub))) : exec(parsedRequest, list[i].param));
            if (socket) return socket;
        } catch {}
    }
    return null;
};
const manualPipe = async (readable, writable) => {
    const _bufferSize = bufferSize, _maxChunkLen = maxChunkLen, _startThreshold = startThreshold, _flushTime = flushTime, _safeBufferSize = _bufferSize - _maxChunkLen;
    let mainBuf = new ArrayBuffer(_bufferSize), offset = 0, time = 2, timerId = null, resume = null, isReading = false, needsFlush = false, totalBytes = 0;
    const flush = () => {
        if (isReading) return needsFlush = true;
        offset > 0 && (writable.send(mainBuf.slice(0, offset)), offset = 0);
        needsFlush = false, timerId && (clearTimeout(timerId), timerId = null), resume?.(), resume = null;
    };
    const reader = readable.getReader({mode: 'byob'});
    try {
        while (true) {
            isReading = true;
            const {done, value} = await reader.read(new Uint8Array(mainBuf, offset, _maxChunkLen));
            if (isReading = false, done) break;
            mainBuf = value.buffer;
            const chunkLen = value.byteLength;
            if (chunkLen < _maxChunkLen) {
                time = 2, chunkLen < 4096 && (totalBytes = 0);
                offset > 0 ? (offset += chunkLen, flush()) : writable.send(value.slice());
            } else {
                totalBytes += chunkLen;
                offset += chunkLen, timerId ||= setTimeout(flush, time), needsFlush && flush();
                offset > _safeBufferSize && (totalBytes > _startThreshold && (time = _flushTime), await new Promise(r => resume = r));
            }
        }
    } finally {isReading = false, flush(), reader.releaseLock()}
};
const handleSession = async (chunk, state, request, writable, close) => {
    if (state.socks5State === 1) {
        let match = chunk.length === socks5Pkg.length;
        for (let i = 0; match && i < socks5Pkg.length; i++) if (chunk[i] !== socks5Pkg[i]) match = false;
        if (match) {
            writable.send(new Uint8Array([1, 0]));
            state.socks5State = 2;
            return;
        }
        writable.send(new Uint8Array([1, 1]));
        return close();
    }
    let parsedRequest = null;
    if (chunk[0] === 5) {
        if (!state.socks5State) {
            const required = socks5AndHttpUser ? 2 : 0;
            const methods = chunk.subarray(2, 2 + chunk[1]);
            if (methods.indexOf(required) === -1) {
                writable.send(new Uint8Array([5, 255]));
                return close();
            }
            writable.send(new Uint8Array([5, required]));
            state.socks5State = required === 2 ? 1 : 2;
            return;
        }
        if (state.socks5State === 2 && chunk[1] === 1) parsedRequest = parseSocks5(chunk);
    } else if (chunk[0] === 67 && chunk[1] === 79) {
        parsedRequest = parseHttp(chunk);
        if (parsedRequest?.authFailed) {
            writable.send(httpRes407);
            return close();
        }
    } else if (chunk.length > 58 && chunk[56] === 13 && chunk[57] === 10) {
        parsedRequest = parseTransparent(chunk);
    } else if ((parsedRequest = parseRequestData(chunk))) {
        writable.send(new Uint8Array([chunk[0], 0]));
    } else {parsedRequest = parseShadow(chunk)}
    if (!parsedRequest) return close();
    parsedRequest.isSocks5 ? writable.send(socks5req) : parsedRequest.isHttp && writable.send(httpRes200);
    const payload = chunk.subarray(parsedRequest.dataOffset);
    if (parsedRequest.isDns) {
        const dnsPack = await dohDnsHandler(payload);
        if (dnsPack?.byteLength) writable.send(dnsPack);
        return close();
    } else {
        state.tcpSocket = await establishTcpConnection(parsedRequest, request);
        if (!state.tcpSocket) return close();
        const tcpWriter = state.tcpSocket.writable.getWriter();
        if (payload.byteLength) await tcpWriter.write(payload);
        state.tcpWriter = (c) => tcpWriter.write(c);
        manualPipe(state.tcpSocket.readable, writable).finally(() => close());
    }
};
const handleWebSocketConn = async (webSocket, request) => {
    const protocolHeader = request.headers.get('sec-websocket-protocol');
    // @ts-ignore
    const earlyData = protocolHeader ? Uint8Array.fromBase64(protocolHeader, {alphabet: 'base64url'}) : null;
    const state = {socks5State: 0, tcpWriter: null, tcpSocket: null};
    const close = () => {state.tcpSocket?.close(), !earlyData && webSocket.close()};
    let processingChain = Promise.resolve();
    const process = async (chunk) => {
        if (state.tcpWriter) return state.tcpWriter(chunk);
        await handleSession(earlyData ? chunk : new Uint8Array(chunk), state, request, webSocket, close);
    };
    if (earlyData) processingChain = processingChain.then(() => process(earlyData).catch(close));
    webSocket.addEventListener("message", event => {processingChain = processingChain.then(() => process(event.data).catch(close))});
};
const xhttpResponseHeaders = {'Content-Type': 'application/octet-stream', 'X-Accel-Buffering': 'no', 'Cache-Control': 'no-store'};
const handleXhttp = async (request) => {
    const _maxChunkLen = maxChunkLen;
    const reader = request.body.getReader({mode: 'byob'});
    const state = {socks5State: 0, tcpWriter: null, tcpSocket: null};
    let sessionBuffer = new ArrayBuffer(_maxChunkLen), used = 0;
    return new Response(new ReadableStream({
        async start(controller) {
            const writable = {send: (chunk) => controller.enqueue(chunk)}, close = () => {reader.releaseLock(), state.tcpSocket?.close(), controller.close()};
            try {
                while (true) {
                    let offset = 0, readLen = _maxChunkLen;
                    !state.tcpWriter && (offset = used, readLen = 8192);
                    const {done, value} = await reader.read(new Uint8Array(sessionBuffer, offset, readLen));
                    if (done) break;
                    sessionBuffer = value.buffer;
                    if (state.tcpWriter) {
                        state.tcpWriter(value.slice());
                        continue;
                    }
                    if (new Uint8Array(sessionBuffer)[0] !== 5 && !state.socks5State) {
                        used += value.byteLength;
                        if (used < 30) continue;
                        await handleSession(new Uint8Array(sessionBuffer, 0, used).slice(), state, request, writable, close);
                    } else {await handleSession(value.slice(), state, request, writable, close)}
                    used = 0;
                }
            } catch {close()} finally {close()}
        },
        cancel() {state.tcpSocket?.close(), reader.releaseLock()}
    }), {headers: xhttpResponseHeaders});
};
export default {
    async fetch(request) {
        if (request.method === 'POST') return handleXhttp(request);
        if (request.headers.get('Upgrade') === 'websocket') {
            const {0: clientSocket, 1: webSocket} = new WebSocketPair();
            webSocket.accept();
            handleWebSocketConn(webSocket, request);
            return new Response(null, {status: 101, webSocket: clientSocket});
        }
        return new Response(html, {status: 200, headers: {'Content-Type': 'text/html; charset=UTF-8'}});
    }
};