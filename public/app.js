const form = document.getElementById('generator-form');
const submitBtn = document.getElementById('submitBtn');
const fillDemoBtn = document.getElementById('fillDemoBtn');
const resultSection = document.getElementById('resultSection');
const warningBox = document.getElementById('warningBox');
const previewBody = document.getElementById('previewBody');

const autoUrl = document.getElementById('autoUrl');
const rawUrl = document.getElementById('rawUrl');
const clashUrl = document.getElementById('clashUrl');
const surgeUrl = document.getElementById('surgeUrl');
const emptyState = document.getElementById('emptyState');

const accessTokenInput = document.getElementById('accessToken');
const loadSubscriptionsBtn = document.getElementById('loadSubscriptionsBtn');
const subscriptionSelect = document.getElementById('subscriptionSelect');
const otherSubscriptionSelect = document.getElementById('otherSubscriptionSelect');
const otherSubscriptionsToggle = document.getElementById('otherSubscriptionsToggle');
const otherSubscriptionsPanel = document.getElementById('otherSubscriptionsPanel');
const appendIpsInput = document.getElementById('appendIps');
const appendBtn = document.getElementById('appendBtn');
const subscriptionContextMenu = document.getElementById('subscriptionContextMenu');
const existingSubscription = document.getElementById('existingSubscription');
const personalAccessKeyInput = document.getElementById('personalAccessKey');
const saveLocalLinkInput = document.getElementById('saveLocalLink');
const generateKeyBtn = document.getElementById('generateKeyBtn');
const clearLocalLinksBtn = document.getElementById('clearLocalLinksBtn');
const localLinksList = document.getElementById('localLinksList');
const appendResult = document.getElementById('appendResult');

const qrModal = document.getElementById('qrModal');
const qrCanvas = document.getElementById('qrCanvas');
const qrText = document.getElementById('qrText');
const closeQrModal = document.getElementById('closeQrModal');

const demoVmess = [
  'vmess://ewogICJ2IjogIjIiLAogICJwcyI6ICJkZW1vLXdzLXRscyIsCiAgImFkZCI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAicG9ydCI6ICI0NDMiLAogICJpZCI6ICIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLAogICJzY3kiOiAiYXV0byIsCiAgIm5ldCI6ICJ3cyIsCiAgInRscyI6ICJ0bHMiLAogICJwYXRoIjogIi93cyIsCiAgImhvc3QiOiAiZWRnZS5leGFtcGxlLmNvbSIsCiAgInNuaSI6ICJlZGdlLmV4YW1wbGUuY29tIiwKICAiZnAiOiAiY2hyb21lIiwKICAiYWxwbiI6ICJoMixodHRwLzEuMSIKfQ=='
].join('\n');

const demoIps = [
  '104.16.1.2#HK-01',
  '104.17.2.3#HK-02',
  '104.18.3.4:2053#US-Edge'
].join('\n');

fillDemoBtn.addEventListener('click', () => {
  document.getElementById('nodeLinks').value = demoVmess;
  document.getElementById('preferredIps').value = demoIps;
  document.getElementById('namePrefix').value = 'CF';
  document.getElementById('keepOriginalHost').checked = true;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  warningBox.classList.add('hidden');
  previewBody.innerHTML = '';

  const payload = {
    nodeLinks: document.getElementById('nodeLinks').value,
    preferredIps: document.getElementById('preferredIps').value,
    namePrefix: document.getElementById('namePrefix').value,
    keepOriginalHost: document.getElementById('keepOriginalHost').checked,
    accessKey: personalAccessKeyInput.value.trim(),
  };

  if (payload.accessKey.length < 8) {
    warningBox.textContent = '请先设置自己的管理密钥（至少 8 位），以后可用它加载和管理订阅。';
    warningBox.classList.remove('hidden');
    personalAccessKeyInput.focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = '生成中...';

  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || '生成失败');
    }

    autoUrl.value = data.urls.auto;
    rawUrl.value = data.urls.raw;
    document.getElementById('rocketUrl').value = data.urls.raw;
    clashUrl.value = data.urls.clash;
    surgeUrl.value = data.urls.surge;

    emptyState.classList.add('hidden');

    document.getElementById('statInputNodes').textContent = data.counts.inputNodes;
    document.getElementById('statEndpoints').textContent = data.counts.preferredEndpoints;
    document.getElementById('statOutputNodes').textContent = data.counts.outputNodes;

    previewBody.innerHTML = data.preview
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.name)}</td>
            <td>${escapeHtml(item.type)}</td>
            <td>${escapeHtml(item.server)}</td>
            <td>${escapeHtml(String(item.port))}</td>
            <td>${escapeHtml(item.host || '-')}</td>
            <td>${escapeHtml(item.sni || '-')}</td>
          </tr>`,
      )
      .join('');

    if (Array.isArray(data.warnings) && data.warnings.length) {
      warningBox.textContent = data.warnings.join('\n');
      warningBox.classList.remove('hidden');
    }

    if (saveLocalLinkInput.checked) {
      saveLocalSubscription({
        label: personalAccessKeyInput.value ? '我的订阅' : '新订阅',
        id: data.shortId,
        auto: data.urls.auto,
        clash: data.urls.clash,
        raw: data.urls.raw,
        accessKey: personalAccessKeyInput.value.trim(),
      });
      appendResult.textContent = '✅ 订阅已生成，并已保存到本机。';
    }

    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    warningBox.textContent = error.message || '请求失败';
    warningBox.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '生成订阅';
  }
});

document.addEventListener('click', async (event) => {
  const copyButton = event.target.closest('[data-copy-target]');
  if (copyButton) {
    const input = document.getElementById(copyButton.dataset.copyTarget);
    if (!input?.value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(input.value);
      const originalText = copyButton.textContent;
      copyButton.textContent = '已复制';
      setTimeout(() => {
        copyButton.textContent = originalText;
      }, 1200);
    } catch {
      input.select();
      document.execCommand('copy');
    }
    return;
  }

  const qrButton = event.target.closest('[data-qrcode-target]');
  if (qrButton) {
    warningBox.classList.add('hidden');

    const input = document.getElementById(qrButton.dataset.qrcodeTarget);
    if (!input?.value) {
      warningBox.textContent = '请先生成订阅链接，再显示二维码。';
      warningBox.classList.remove('hidden');
      return;
    }

    if (!window.QRCode) {
      warningBox.textContent = '二维码组件加载失败，请刷新页面后重试。';
      warningBox.classList.remove('hidden');
      return;
    }

    qrCanvas.innerHTML = '';
    qrText.textContent = input.value;
    qrModal.classList.remove('hidden');
    qrModal.setAttribute('aria-hidden', 'false');

    new window.QRCode(qrCanvas, {
      text: input.value,
      width: 220,
      height: 220,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
    return;
  }

  if (event.target.closest('[data-close-modal="true"]')) {
    closeQrDialog();
  }
});

closeQrModal.addEventListener('click', closeQrDialog);

loadSubscriptionsBtn.addEventListener('click', async () => {
  const token = accessTokenInput.value.trim();
  if (!token) {
    appendResult.textContent = '请先填写访问令牌。';
    return;
  }
  appendResult.textContent = '加载中...';
  try {
    const response = await fetch(`/api/subscriptions?token=${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || '加载失败');
    const adminIds = new Set(['9oeChZMJix', 'wcMiHZx54Z']);
    const adminItems = data.subscriptions.filter((item) => adminIds.has(item.id));
    const otherItems = data.subscriptions.filter((item) => !adminIds.has(item.id));
    const fillSelect = (select, items, emptyText) => {
      select.innerHTML = `<option value="" disabled hidden>${emptyText}</option>`;
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = `${item.label}（${item.nodeCount} 个节点）`;
        select.appendChild(option);
      }
      select.disabled = false;
    };
    fillSelect(subscriptionSelect, adminItems, '暂无置顶订阅');
    fillSelect(otherSubscriptionSelect, otherItems, '暂无其他订阅');
    otherSubscriptionsToggle.querySelector('span').textContent = `展开（${otherItems.length}）`;
    subscriptionSelect.disabled = adminItems.length === 0;
    otherSubscriptionSelect.disabled = otherItems.length === 0;
    updateSelectionState();
    appendResult.textContent = `已加载 ${data.subscriptions.length} 条订阅，其中我的订阅 ${adminItems.length} 条。`;
  } catch (error) {
    appendResult.textContent = error.message || '加载失败';
  }
});

otherSubscriptionsToggle.addEventListener('click', () => {
  const isHidden = otherSubscriptionsPanel.classList.toggle('hidden');
  otherSubscriptionsToggle.querySelector('span').textContent = isHidden ? '展开' : '收起';
});

function getSelectedOptions() {
  return [...subscriptionSelect.selectedOptions, ...otherSubscriptionSelect.selectedOptions];
}

function updateSelectionState() {
  const selectedCount = getSelectedOptions().length;
  appendBtn.disabled = false;
  appendResult.textContent = selectedCount > 1
    ? '当前多选了订阅；追加 IP 时请只保留一条。'
    : selectedCount === 1
      ? '已选择 1 条订阅，可以追加 IP。'
      : '请先选择 1 条订阅，再追加 IP。';
}

subscriptionSelect.addEventListener('change', updateSelectionState);
otherSubscriptionSelect.addEventListener('change', updateSelectionState);

let scrollbarTimer;
for (const select of [subscriptionSelect, otherSubscriptionSelect]) {
  select.addEventListener('scroll', () => {
    select.classList.add('scrolling');
    clearTimeout(scrollbarTimer);
    scrollbarTimer = setTimeout(() => select.classList.remove('scrolling'), 700);
  });
  select.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const targetRect = event.currentTarget.getBoundingClientRect();
    const cardRect = existingSubscription.getBoundingClientRect();
    const menuWidth = 220;
    const left = Math.max(24, Math.min(targetRect.right - cardRect.left - menuWidth, cardRect.width - menuWidth - 24));
    subscriptionContextMenu.style.left = `${left}px`;
    subscriptionContextMenu.style.right = 'auto';
    subscriptionContextMenu.style.top = `${targetRect.bottom - cardRect.top + 8}px`;
    subscriptionContextMenu.classList.remove('hidden');
  });
}

document.addEventListener('click', (event) => {
  if (!event.target.closest('#subscriptionContextMenu')) subscriptionContextMenu.classList.add('hidden');
});

subscriptionContextMenu.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-sub-action]')?.dataset.subAction;
  if (!action) return;
  subscriptionContextMenu.classList.add('hidden');
  if (action === 'delete') await deleteSelectedSubscriptions();
  if (action === 'copy') await copySelectedSubscriptionLinks();
  if (action === 'refresh') loadSubscriptionsBtn.click();
  if (action === 'clear') {
    subscriptionSelect.selectedIndex = -1;
    otherSubscriptionSelect.selectedIndex = -1;
    updateSelectionState();
  }
});

async function deleteSelectedSubscriptions() {
  const token = accessTokenInput.value.trim();
  const selected = getSelectedOptions();
  if (!token || !selected.length) {
    appendResult.textContent = '请先选择至少一条订阅。';
    return;
  }
  const labels = selected.map((option) => option.textContent).join('\n');
  if (!window.confirm(`确定删除以下 ${selected.length} 条订阅吗？删除后链接将失效，无法恢复。\n\n${labels}`)) return;

  appendResult.textContent = `正在删除 ${selected.length} 条订阅...`;
  try {
    const results = await Promise.all(selected.map(async (option) => {
      const response = await fetch(`/api/subscriptions/${encodeURIComponent(option.value)}?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || `${option.value} 删除失败`);
      return option;
    }));
    for (const option of results) option.remove();
    subscriptionSelect.selectedIndex = -1;
    otherSubscriptionSelect.selectedIndex = -1;
    updateSelectionState();
    appendResult.textContent = `✅ 已批量删除 ${results.length} 条订阅`;
  } catch (error) {
    appendResult.textContent = `❌ ${error.message || '批量删除失败'}`;
  }
}

async function copySelectedSubscriptionLinks() {
  const token = accessTokenInput.value.trim();
  const selected = getSelectedOptions();
  if (!token || !selected.length) {
    appendResult.textContent = '请先选择至少一条订阅。';
    return;
  }
  const links = selected.map((option) => `${window.location.origin}/sub/${option.value}?target=clash&token=${encodeURIComponent(token)}`);
  try {
    await navigator.clipboard.writeText(links.join('\n'));
    appendResult.textContent = `✅ 已复制 ${links.length} 条 Clash 订阅链接`;
  } catch {
    appendResult.textContent = '复制失败，请检查浏览器剪贴板权限。';
  }
}

appendBtn.addEventListener('click', async () => {
  const token = accessTokenInput.value.trim();
  const selected = getSelectedOptions();
  const updateId = selected[0]?.value;
  const appendPreferredIps = appendIpsInput.value.trim();
  if (!token || selected.length !== 1 || !updateId || !appendPreferredIps) {
    appendResult.textContent = selected.length > 1
      ? '追加 IP 一次只能选择 1 条订阅；多选请使用右键菜单。'
      : '请填写管理密钥、选择 1 条订阅并填入新增 IP。';
    return;
  }
  appendBtn.disabled = true;
  appendResult.textContent = '更新中...';
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sub-access-token': token },
      body: JSON.stringify({ updateId, appendPreferredIps, keepOriginalHost: true }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || '更新失败');
    appendResult.textContent = `✅ 已追加 ${data.appendedCount} 个 IP，原链接保持不变：${data.shortId}`;
    appendIpsInput.value = '';
  } catch (error) {
    appendResult.textContent = `❌ ${error.message || '更新失败'}`;
  } finally {
    appendBtn.disabled = false;
  }
});

clearLocalLinksBtn.addEventListener('click', () => {
  if (!window.confirm('确定清空本机保存的订阅记录吗？不会删除服务器上的订阅。')) return;
  localStorage.removeItem('cloudflaresub.savedSubscriptions');
  renderLocalSubscriptions();
});

generateKeyBtn.addEventListener('click', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  personalAccessKeyInput.value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
});

localLinksList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-local-action]');
  if (!button) return;
  const id = button.dataset.id;
  const saved = readLocalSubscriptions();
  const item = saved.find((entry) => entry.id === id);
  if (!item) return;
  if (button.dataset.localAction === 'delete') {
    localStorage.setItem('cloudflaresub.savedSubscriptions', JSON.stringify(saved.filter((entry) => entry.id !== id)));
    renderLocalSubscriptions();
  }
  if (button.dataset.localAction === 'copy') {
    await navigator.clipboard.writeText(item.clash || item.auto);
    appendResult.textContent = '✅ 已复制本机保存的 Clash 链接。';
  }
});

function readLocalSubscriptions() {
  try {
    const items = JSON.parse(localStorage.getItem('cloudflaresub.savedSubscriptions') || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function saveLocalSubscription(item) {
  const saved = readLocalSubscriptions().filter((entry) => entry.id !== item.id);
  saved.unshift({ ...item, savedAt: new Date().toISOString() });
  localStorage.setItem('cloudflaresub.savedSubscriptions', JSON.stringify(saved.slice(0, 30)));
  renderLocalSubscriptions();
}

function renderLocalSubscriptions() {
  const saved = readLocalSubscriptions();
  if (!saved.length) {
    localLinksList.innerHTML = '<span class="hint">还没有保存的订阅。</span>';
    return;
  }
  localLinksList.innerHTML = saved.map((item) => `
    <div class="local-link-item">
      <span>${escapeHtml(item.label || item.id)} <code>${escapeHtml(item.id)}</code></span>
      <span class="local-link-actions">
        <button type="button" class="secondary small" data-local-action="copy" data-id="${escapeHtml(item.id)}">复制</button>
        <button type="button" class="secondary small" data-local-action="delete" data-id="${escapeHtml(item.id)}">移除</button>
      </span>
    </div>`).join('');
}

renderLocalSubscriptions();

function closeQrDialog() {
  qrModal.classList.add('hidden');
  qrModal.setAttribute('aria-hidden', 'true');
  qrCanvas.innerHTML = '';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
