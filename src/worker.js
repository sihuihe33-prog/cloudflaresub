// Cloudflare Worker: KV short link subscription + access token protection
// Requires:
// - KV namespace binding: SUB_STORE
// - Secret/Variable: SUB_ACCESS_TOKEN
// Optional:
// - Secret/Variable: SUB_LINK_SECRET (legacy long-token compatibility)

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    },
  });
}

function text(body, status = 200, contentType = 'text/plain; charset=utf-8') {
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      'access-control-allow-origin': '*',
    },
  });
}

function b64EncodeUtf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function b64DecodeUtf8(str) {
  return decodeURIComponent(escape(atob(str)));
}

function escapeYaml(str = '') {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ');
}

function parsePreferredEndpoints(input) {
  return String(input || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [raw, remark = ''] = line.split('#');
      const value = raw.trim();
      const hashRemark = remark.trim();
      const match = value.match(/^(.*?)(?::(\d+))?$/);
      return {
        server: match?.[1] || value,
        port: match?.[2] ? Number(match[2]) : undefined,
        remark: hashRemark,
      };
    });
}

function parseVmess(link) {
  const raw = link.slice('vmess://'.length).trim();
  const obj = JSON.parse(b64DecodeUtf8(raw));
  return {
    type: 'vmess',
    name: obj.ps || 'vmess',
    server: obj.add,
    port: Number(obj.port || 443),
    uuid: obj.id,
    cipher: obj.scy || 'auto',
    network: obj.net || 'ws',
    tls: obj.tls === 'tls',
    host: obj.host || '',
    path: obj.path || '/',
    sni: obj.sni || obj.host || '',
    alpn: obj.alpn || '',
    fp: obj.fp || '',
  };
}

function parseUrlLike(link, type) {
  const u = new URL(link);
  return {
    type,
    name: decodeURIComponent(u.hash.replace(/^#/, '')) || type,
    server: u.hostname,
    port: Number(u.port || 443),
    password: type === 'trojan' ? decodeURIComponent(u.username) : undefined,
    uuid: type === 'vless' ? decodeURIComponent(u.username) : undefined,
    network: u.searchParams.get('type') || 'tcp',
    tls: (u.searchParams.get('security') || '').toLowerCase() === 'tls',
    host: u.searchParams.get('host') || u.searchParams.get('sni') || '',
    path: u.searchParams.get('path') || '/',
    sni: u.searchParams.get('sni') || u.searchParams.get('host') || '',
    fp: u.searchParams.get('fp') || '',
    alpn: u.searchParams.get('alpn') || '',
    flow: u.searchParams.get('flow') || '',
  };
}

function parseRawLinks(input) {
  const lines = String(input || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const result = [];
  for (const line of lines) {
    if (line.startsWith('vmess://')) {
      result.push(parseVmess(line));
      continue;
    }
    if (line.startsWith('vless://')) {
      result.push(parseUrlLike(line, 'vless'));
      continue;
    }
    if (line.startsWith('trojan://')) {
      result.push(parseUrlLike(line, 'trojan'));
      continue;
    }
    try {
      const decoded = b64DecodeUtf8(line);
      if (/^(vmess|vless|trojan):\/\//m.test(decoded)) {
        result.push(...parseRawLinks(decoded));
      }
    } catch {}
  }
  return result;
}

function buildNodes(baseNodes, preferredEndpoints, options = {}) {
  const output = [];
  const prefix = (options.namePrefix || '').trim();
  let counter = 0;
  for (const node of baseNodes) {
    for (const ep of preferredEndpoints) {
      counter += 1;
      const nameParts = [];
      // usePrefixOnly: the daily RN updater wants `<prefix> | <remark>` without the base node's own name.
      if (node.name && !(options.usePrefixOnly && prefix)) nameParts.push(node.name);
      if (prefix) nameParts.push(prefix);
      if (ep.remark) nameParts.push(ep.remark);
      else nameParts.push(String(counter));
      output.push({
        ...node,
        name: nameParts.join(' | '),
        server: ep.server,
        port: ep.port || node.port,
        host: options.keepOriginalHost ? node.host : '',
        sni: options.keepOriginalHost ? node.sni : '',
      });
    }
  }
  return output;
}

function encodeVmess(node) {
  const obj = {
    v: '2',
    ps: node.name,
    add: node.server,
    port: String(node.port),
    id: node.uuid,
    aid: '0',
    scy: node.cipher || 'auto',
    net: node.network || 'ws',
    type: 'none',
    host: node.host || '',
    path: node.path || '/',
    tls: node.tls ? 'tls' : '',
    sni: node.sni || '',
    alpn: node.alpn || '',
    fp: node.fp || '',
  };
  return 'vmess://' + b64EncodeUtf8(JSON.stringify(obj));
}

function encodeVless(node) {
  const url = new URL(`vless://${encodeURIComponent(node.uuid)}@${node.server}:${node.port}`);
  url.searchParams.set('type', node.network || 'ws');
  if (node.tls) url.searchParams.set('security', 'tls');
  if (node.host) url.searchParams.set('host', node.host);
  if (node.sni) url.searchParams.set('sni', node.sni);
  if (node.path) url.searchParams.set('path', node.path);
  if (node.alpn) url.searchParams.set('alpn', node.alpn);
  if (node.fp) url.searchParams.set('fp', node.fp);
  if (node.flow) url.searchParams.set('flow', node.flow);
  url.hash = node.name;
  return url.toString();
}

function encodeTrojan(node) {
  const url = new URL(`trojan://${encodeURIComponent(node.password)}@${node.server}:${node.port}`);
  if (node.network) url.searchParams.set('type', node.network);
  if (node.tls) url.searchParams.set('security', 'tls');
  if (node.host) url.searchParams.set('host', node.host);
  if (node.sni) url.searchParams.set('sni', node.sni);
  if (node.path) url.searchParams.set('path', node.path);
  if (node.alpn) url.searchParams.set('alpn', node.alpn);
  if (node.fp) url.searchParams.set('fp', node.fp);
  url.hash = node.name;
  return url.toString();
}

function renderRaw(nodes) {
  const lines = nodes
    .map((node) => {
      if (node.standalone === true) return '';
      if (node.type === 'vmess') return encodeVmess(node);
      if (node.type === 'vless') return encodeVless(node);
      if (node.type === 'trojan') return encodeTrojan(node);
      return '';
    })
    .filter(Boolean);
  return b64EncodeUtf8(lines.join('\n'));
}

function renderClash(nodes) {
  // Flow-style YAML (valid YAML, since JSON is a YAML subset) for a verbatim
  // standalone Clash proxy such as VLESS+Reality.
  const YAML_LINE = (obj) => `  - ${JSON.stringify(obj)}`;
  const isRackNerd = nodes.some((node) => String(node.name || '').startsWith('RackNerd|'));
  const mainGroupName = isRackNerd ? 'RackNerd' : '节点选择';
  const displayName = (node) => isRackNerd && String(node.name || '').startsWith('RackNerd|')
    ? node.name.slice('RackNerd|'.length) : node.name;
  const proxies = nodes
    .map((node) => {
      if (node.standalone === true && node.type === 'vless') {
        const { standalone, ...clean } = node;
        return YAML_LINE(clean);
      }
      if (node.type === 'hysteria2') {
        const fields = ['name', 'type', 'server', 'port', 'password', 'sni', 'alpn', 'obfs', 'obfs-password', 'udp', 'skip-cert-verify', 'up', 'down', 'ports'];
        return fields.filter((key) => node[key] !== undefined)
          .map((key, index) => `${index === 0 ? '  - ' : '    '}${key}: ${key === 'type' ? 'hysteria2' : JSON.stringify(key === 'name' ? displayName(node) : node[key])}`)
          .join('\n');
      }
      if (node.type === 'vmess') {
        const lines = [
          `  - name: "${escapeYaml(displayName(node))}"`,
          `    type: vmess`,
          `    server: ${node.server}`,
          `    port: ${node.port}`,
          `    uuid: ${node.uuid}`,
          `    alterId: 0`,
          `    cipher: ${node.cipher || 'auto'}`,
          `    udp: true`,
          `    tls: ${node.tls ? 'true' : 'false'}`,
          `    network: ${node.network || 'ws'}`,
        ];

        if (node.sni) {
          lines.push(`    servername: "${escapeYaml(node.sni)}"`);
        }

        if ((node.network || 'ws') === 'ws') {
          lines.push(
            `    ws-opts:`,
            `      path: "${escapeYaml(node.path || '/')}"`,
            `      headers:`,
            `        Host: "${escapeYaml(node.host || node.sni || '')}"`
          );
        }

        return lines.join('\n');
      }

      if (node.type === 'vless') {
        const lines = [
          `  - name: "${escapeYaml(displayName(node))}"`,
          `    type: vless`,
          `    server: ${node.server}`,
          `    port: ${node.port}`,
          `    uuid: ${node.uuid}`,
          `    udp: true`,
          `    tls: ${node.tls ? 'true' : 'false'}`,
          `    network: ${node.network || 'ws'}`,
        ];

        if (node.sni) {
          lines.push(`    servername: "${escapeYaml(node.sni)}"`);
        }

        if ((node.network || 'ws') === 'ws') {
          lines.push(
            `    ws-opts:`,
            `      path: "${escapeYaml(node.path || '/')}"`,
            `      headers:`,
            `        Host: "${escapeYaml(node.host || node.sni || '')}"`
          );
        }

        return lines.join('\n');
      }

      if (node.type === 'trojan') {
        const lines = [
          `  - name: "${escapeYaml(displayName(node))}"`,
          `    type: trojan`,
          `    server: ${node.server}`,
          `    port: ${node.port}`,
          `    password: "${escapeYaml(node.password || '')}"`,
          `    udp: true`,
        ];

        if (node.sni) {
          lines.push(`    sni: "${escapeYaml(node.sni)}"`);
        }

        if (node.tls !== false) {
          lines.push(`    tls: true`);
        }

        if (node.network) {
          lines.push(`    network: ${node.network}`);
        }

        if (node.network === 'ws') {
          lines.push(
            `    ws-opts:`,
            `      path: "${escapeYaml(node.path || '/')}"`,
            `      headers:`,
            `        Host: "${escapeYaml(node.host || node.sni || '')}"`
          );
        }

        return lines.join('\n');
      }

      return '';
    })
    .filter(Boolean);

  const isDmit = (node) => (node.type === 'hysteria2' || node.standalone === true) && node.server === 'dmit.gghui.top';
  const proxyNames = nodes.filter((node) => !isDmit(node)).map(
    (node) => `      - "${escapeYaml(displayName(node))}"`
  );
  const dmitProxyNames = nodes
    .filter(isDmit)
    .map((node) => `      - "${escapeYaml(displayName(node))}"`);

  const allGroupMembers = [
    `      - "自动选择"`,
    ...proxyNames,
    `      - DIRECT`,
  ];

  const autoGroupMembers = proxyNames.length ? proxyNames : [`      - DIRECT`];
  // RN subscriptions that also carry DMIT get a top-level switch so rule mode can pick either line.
  const hasTopSelector = isRackNerd && dmitProxyNames.length > 0;
  const ruleTarget = hasTopSelector ? '节点选择' : mainGroupName;

  return [
    `mixed-port: 7890`,
    `allow-lan: false`,
    `mode: rule`,
    `log-level: info`,
    `ipv6: true`,
    ``,
    `proxies:`,
    ...(proxies.length ? proxies : []),
    ``,
    `proxy-groups:`,
    ...(hasTopSelector ? [
      `  - name: "节点选择"`,
      `    type: select`,
      `    proxies:`,
      `      - "${escapeYaml(mainGroupName)}"`,
      `      - "DMIT"`,
      ``,
    ] : []),
    `  - name: "自动选择"`,
    `    type: url-test`,
    ...(hasTopSelector ? [`    hidden: true`] : []),
    `    url: "http://www.gstatic.com/generate_204"`,
    `    interval: 300`,
    `    tolerance: 50`,
    `    proxies:`,
    ...autoGroupMembers,
    ``,
    ...(dmitProxyNames.length ? [
      `  - name: "DMIT"`,
      `    type: select`,
      `    proxies:`,
      ...dmitProxyNames,
      ``,
    ] : []),
    `  - name: "${escapeYaml(mainGroupName)}"`,
    `    type: select`,
    `    proxies:`,
    ...allGroupMembers,
    ``,
    `rules:`,
    // RN/DMIT exit through a SOCKS static IP that drops UDP: reject QUIC so YouTube etc. fall back to TCP at once.
    ...(isRackNerd ? [`  - AND,((NETWORK,UDP),(DST-PORT,443)),REJECT`] : []),
    `  - MATCH,${ruleTarget}`,
  ].join('\n');
}

function renderSurge(nodes, baseUrl, accessToken) {
  const proxies = nodes
    .filter((node) => node.type === 'vmess' || node.type === 'trojan')
    .map((node) => {
      if (node.type === 'vmess') {
        return `${node.name} = vmess, ${node.server}, ${node.port}, username=${node.uuid}, ws=true, ws-path=${node.path || '/'}, ws-headers=Host:${node.host || ''}, tls=${node.tls ? 'true' : 'false'}, sni=${node.sni || ''}`;
      }
      return `${node.name} = trojan, ${node.server}, ${node.port}, password=${node.password || ''}, sni=${node.sni || ''}`;
    });

  return [
    '[General]',
    'skip-proxy = 127.0.0.1, localhost',
    '',
    '[Proxy]',
    ...proxies,
    '',
    '[Proxy Group]',
    'Proxy = select, ' +
      nodes
        .filter((n) => n.type === 'vmess' || n.type === 'trojan')
        .map((n) => n.name)
        .join(', '),
    '',
    '[Rule]',
    'FINAL,Proxy',
    '',
    '; token-protected subscription',
    `; ${baseUrl}?token=${accessToken}`,
  ].join('\n');
}

function createShortId(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

async function createUniqueShortId(env, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const id = createShortId(10);
    const exists = await env.SUB_STORE.get(`sub:${id}`);
    if (!exists) return id;
  }
  throw new Error('无法生成唯一短链接，请稍后再试');
}

function normalizeLines(value = '') {
  return String(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort()
    .join('\n');
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function buildDedupHash(body) {
  const normalized = {
    nodeLinks: normalizeLines(body.nodeLinks || ''),
    preferredIps: normalizeLines(body.preferredIps || ''),
    namePrefix: String(body.namePrefix || '').trim(),
    keepOriginalHost: body.keepOriginalHost !== false,
  };
  return sha256Hex(JSON.stringify(normalized));
}

async function handleGenerate(request, env, url) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '请求体不是合法 JSON' }, 400);
  }

  const updateId = String(body.updateId || '').trim();
  if (updateId && !/^[a-zA-Z0-9]{1,64}$/.test(updateId)) {
    return json({ ok: false, error: 'Invalid updateId' }, 400);
  }

  // Preserve all existing nodes and the short URL. A standalone Hysteria2
  // node must NOT be fed into buildNodes(), which replaces servers with CF IPs.
  if (updateId && body.appendClashProxy !== undefined) {
    const expected = env.SUB_ACCESS_TOKEN;
    if (!expected || request.headers.get('x-sub-access-token') !== expected) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }
    const raw = await env.SUB_STORE.get(`sub:${updateId}`);
    if (!raw) return json({ ok: false, error: 'updateId not found' }, 404);
    const node = body.appendClashProxy;
    const HY2_KEYS = ['name', 'type', 'server', 'port', 'password', 'sni', 'alpn', 'obfs', 'obfs-password', 'udp', 'skip-cert-verify', 'up', 'down', 'ports'];
    const REALITY_KEYS = ['name', 'type', 'server', 'port', 'uuid', 'network', 'tls', 'udp', 'flow', 'servername', 'client-fingerprint', 'reality-opts'];
    const base = node && typeof node === 'object' && !Array.isArray(node)
      && typeof node.name === 'string' && node.name.length > 0 && node.name.length <= 100
      && typeof node.server === 'string' && /^[a-zA-Z0-9.-]{1,253}$/.test(node.server)
      && Number.isInteger(node.port) && node.port >= 1 && node.port <= 65535;
    const isHy2 = base && node.type === 'hysteria2'
      && typeof node.password === 'string' && node.password.length > 0
      && Object.keys(node).every((key) => HY2_KEYS.includes(key));
    const ro = node && node['reality-opts'];
    const isReality = base && node.type === 'vless' && node.tls === true && node.network === 'tcp'
      && typeof node.uuid === 'string' && /^[0-9a-fA-F-]{36}$/.test(node.uuid)
      && typeof node.servername === 'string' && /^[a-zA-Z0-9.-]{1,253}$/.test(node.servername)
      && ro && typeof ro === 'object' && typeof ro['public-key'] === 'string' && /^[A-Za-z0-9_-]{43}$/.test(ro['public-key'])
      && typeof ro['short-id'] === 'string' && /^[0-9a-fA-F]{0,16}$/.test(ro['short-id'])
      && Object.keys(ro).every((key) => ['public-key', 'short-id', 'support-x25519mlkem768'].includes(key))
      && Object.keys(node).every((key) => REALITY_KEYS.includes(key));
    if (!isHy2 && !isReality) return json({ ok: false, error: 'Invalid standalone proxy' }, 400);
    const record = JSON.parse(raw);
    const nodes = record.nodes || [];
    const same = (a) => a.type === node.type && a.server === node.server && a.port === node.port
      && (node.type === 'hysteria2' ? a.password === node.password : a.uuid === node.uuid);
    if (nodes.some((existing) => existing.name === node.name && !same(existing))) {
      return json({ ok: false, error: 'Proxy name already in use' }, 409);
    }
    const alreadyPresent = nodes.some(same);
    if (!alreadyPresent) {
      nodes.push(isReality ? { ...node, standalone: true } : node);
      await env.SUB_STORE.put(`sub:${updateId}`, JSON.stringify({ ...record, nodes }));
    }
    return json({ ok: true, updated: !alreadyPresent, shortId: updateId, appendedCount: alreadyPresent ? 0 : 1, counts: { outputNodes: nodes.length } });
  }

  const baseNodes = parseRawLinks(body.nodeLinks || '');
  const preferredEndpoints = parsePreferredEndpoints(body.preferredIps || '');

  if (!baseNodes.length) return json({ ok: false, error: '没有识别到可用节点' }, 400);
  if (!preferredEndpoints.length) return json({ ok: false, error: '没有识别到可用优选地址' }, 400);

  const options = {
    namePrefix: body.namePrefix || '',
    usePrefixOnly: body.usePrefixOnly === true,
    compactName: body.compactName === true,
    keepOriginalHost: body.keepOriginalHost !== false,
  };

  const nodes = buildNodes(baseNodes, preferredEndpoints, options);

  const payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    options,
    nodes,
  };

  const dedupHash = await buildDedupHash(body);
  const dedupKey = `dedup:${dedupHash}`;

  // In-place update: when the request carries updateId and that id exists,
  // rewrite the KV record under the SAME id so the subscription link never changes.
  if (updateId) {
    const existing = await env.SUB_STORE.get(`sub:${updateId}`);
    if (!existing) {
      return json({ ok: false, error: `updateId 不存在：${updateId}` }, 404);
    }
    // CFST refreshes the preferred-IP nodes through this legacy endpoint.
    // Keep standalone HY2 nodes that were appended to the fixed URL.
    const standalone = (JSON.parse(existing).nodes || []).filter((node) => node.type === 'hysteria2' || node.standalone === true);
    payload.nodes = [...nodes, ...standalone.filter((node) => !nodes.some((base) => base.name === node.name))];
    const ttl = 60 * 60 * 24 * 7; // 7天，与原逻辑一致
    await env.SUB_STORE.put(`sub:${updateId}`, JSON.stringify(payload), {
      expirationTtl: ttl,
    });
    await env.SUB_STORE.put(dedupKey, updateId, {
      expirationTtl: ttl,
    });

    const origin = url.origin;
    const accessToken = env.SUB_ACCESS_TOKEN || '';
    const withToken = (target) =>
      `${origin}/sub/${updateId}${
        target
          ? `?target=${target}&token=${encodeURIComponent(accessToken)}`
          : `?token=${encodeURIComponent(accessToken)}`
      }`;

    return json({
      ok: true,
      storage: 'kv',
      updated: true,
      shortId: updateId,
      urls: {
        auto: withToken(''),
        raw: withToken('raw'),
        clash: withToken('clash'),
        surge: withToken('surge'),
      },
      counts: {
        inputNodes: baseNodes.length,
        preferredEndpoints: preferredEndpoints.length,
        outputNodes: payload.nodes.length,
      },
      preview: payload.nodes.slice(0, 20).map((node) => ({
        name: node.name,
        type: node.type,
        server: node.server,
        port: node.port,
        host: node.host || '',
        sni: node.sni || '',
      })),
      warnings: accessToken ? [] : ['未检测到 SUB_ACCESS_TOKEN，订阅链接将没有第二层访问保护。'],
    });
  }

  let id = await env.SUB_STORE.get(dedupKey);

  if (!id) {
    id = await createUniqueShortId(env);
    const ttl = 60 * 60 * 24 * 7; // 7天

    await env.SUB_STORE.put(`sub:${id}`, JSON.stringify(payload), {
      expirationTtl: ttl,
    });

    await env.SUB_STORE.put(dedupKey, id, {
      expirationTtl: ttl,
    });
  }

  const origin = url.origin;
  const accessToken = env.SUB_ACCESS_TOKEN || '';
  const withToken = (target) =>
    `${origin}/sub/${id}${
      target
        ? `?target=${target}&token=${encodeURIComponent(accessToken)}`
        : `?token=${encodeURIComponent(accessToken)}`
    }`;

  return json({
    ok: true,
    storage: 'kv',
    deduplicated: true,
    shortId: id,
    urls: {
      auto: withToken(''),
      raw: withToken('raw'),
      clash: withToken('clash'),
      surge: withToken('surge'),
    },
    counts: {
      inputNodes: baseNodes.length,
      preferredEndpoints: preferredEndpoints.length,
      outputNodes: nodes.length,
    },
    preview: nodes.slice(0, 20).map((node) => ({
      name: node.name,
      type: node.type,
      server: node.server,
      port: node.port,
      host: node.host || '',
      sni: node.sni || '',
    })),
    warnings: accessToken ? [] : ['未检测到 SUB_ACCESS_TOKEN，订阅链接将没有第二层访问保护。'],
  });
}

function validateAccessToken(url, env) {
  const expected = env.SUB_ACCESS_TOKEN;
  if (!expected) return { ok: true };
  const provided = url.searchParams.get('token') || '';
  if (!provided || provided !== expected) {
    return { ok: false, response: text('Forbidden: invalid token', 403) };
  }
  return { ok: true };
}

async function handleSub(url, env) {
  const tokenCheck = validateAccessToken(url, env);
  if (!tokenCheck.ok) return tokenCheck.response;

  const id = url.pathname.split('/').pop();
  if (!id) return text('missing id', 400);

  const raw = await env.SUB_STORE.get(`sub:${id}`);
  if (!raw) return text('not found', 404);

  const record = JSON.parse(raw);
  const nodes = record.nodes || [];
  const target = (url.searchParams.get('target') || 'raw').toLowerCase();

  if (target === 'clash') {
    return text(renderClash(nodes), 200, 'text/yaml; charset=utf-8');
  }
  if (target === 'surge') {
    return text(
      renderSurge(nodes, url.origin + url.pathname, env.SUB_ACCESS_TOKEN || ''),
      200,
      'text/plain; charset=utf-8',
    );
  }
  return text(renderRaw(nodes), 200, 'text/plain; charset=utf-8');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
    }

    if (request.method === 'POST' && url.pathname === '/api/generate') {
      return handleGenerate(request, env, url);
    }

    if (request.method === 'GET' && url.pathname.startsWith('/sub/')) {
      return handleSub(url, env);
    }

    return env.ASSETS.fetch(request);
  },
};