// Service Worker 版本
const VERSION = '1.0.0';

// 缓存名称
const CACHE_NAME = `stock-monitor-${VERSION}`;

// 需要缓存的资源
const CACHE_URLS = [
    '/',
    '/index.html',
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net/npm/echarts@5.4.2/dist/echarts.min.js',
    'https://cdn.jsdelivr.net/npm/text-encoding@0.7.0/lib/encoding.min.js',
    'https://cdn.jsdelivr.net/npm/preline@2.0.3/dist/preline.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// 调试日志
function log(message, data = null) {
    console.log(`[Service Worker ${VERSION}] ${message}`, data || '');
}

// 错误处理
function handleError(error, context) {
    console.error(`[Service Worker ${VERSION}] Error in ${context}:`, error);
    // 向所有客户端发送错误信息
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({
                type: 'ERROR',
                context,
                message: error.message
            });
        });
    });
}

// 安装 Service Worker
self.addEventListener('install', event => {
    log('Installing Service Worker...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                log('Caching resources');
                return cache.addAll(CACHE_URLS);
            })
            .then(() => {
                log('Service Worker installed successfully');
                return self.skipWaiting();
            })
            .catch(error => handleError(error, 'install'))
    );
});

// 激活 Service Worker
self.addEventListener('activate', event => {
    log('Activating Service Worker...');
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            log(`Deleting old cache: ${cacheName}`);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
            .then(() => {
                log('Service Worker activated successfully');
                return self.clients.claim();
            })
            .catch(error => handleError(error, 'activate'))
    );
});

// 处理后台同步
self.addEventListener('sync', event => {
    log(`Background sync event: ${event.tag}`);
    if (event.tag === 'stockUpdate' || event.tag === 'testSync') {
        event.waitUntil(
            handleStockUpdate()
                .catch(error => handleError(error, 'sync'))
        );
    }
});

// 处理股票数据更新
async function handleStockUpdate() {
    try {
        const clients = await self.clients.matchAll();
        log(`Found ${clients.length} clients`);
        
        // 向每个客户端发送更新消息
        clients.forEach(client => {
            const message = {
                type: 'STOCK_UPDATE',
                timestamp: Date.now()
            };
            log('Sending update message to client', message);
            client.postMessage(message);
        });

        // 如果是测试同步，发送测试通知
        if (event.tag === 'testSync') {
            await self.registration.showNotification('后台同步测试', {
                body: '后台同步功能正常工作',
                icon: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%230ea5e9"%3E%3Cpath d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/%3E%3C/svg%3E'
            });
        }
    } catch (error) {
        handleError(error, 'handleStockUpdate');
        throw error;
    }
}

// 处理推送通知
self.addEventListener('push', event => {
    log('Push event received');
    try {
        const data = event.data.json();
        log('Push data:', data);
        
        const options = {
            body: data.body,
            icon: data.icon,
            badge: data.badge,
            data: data.data,
            actions: data.actions
        };

        event.waitUntil(
            self.registration.showNotification(data.title, options)
                .then(() => log('Notification shown successfully'))
                .catch(error => handleError(error, 'push'))
        );
    } catch (error) {
        handleError(error, 'push');
    }
});

// 处理通知点击
self.addEventListener('notificationclick', event => {
    log('Notification clicked');
    event.notification.close();

    event.waitUntil(
        clients.matchAll({ type: 'window' })
            .then(clientList => {
                if (clientList.length > 0) {
                    log('Focusing existing window');
                    return clientList[0].focus();
                } else {
                    log('Opening new window');
                    return clients.openWindow('/');
                }
            })
            .catch(error => handleError(error, 'notificationclick'))
    );
});

// 处理网络请求
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    log(`Fetching: ${url.pathname}`);

    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    log('Cache hit:', url.pathname);
                    return response;
                }

                log('Cache miss:', url.pathname);
                return fetch(event.request)
                    .then(response => {
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then(cache => {
                                log('Caching new response:', url.pathname);
                                cache.put(event.request, responseToCache);
                            })
                            .catch(error => handleError(error, 'cache-put'));

                        return response;
                    })
                    .catch(error => {
                        handleError(error, 'fetch');
                        throw error;
                    });
            })
    );
});

// 处理客户端消息
self.addEventListener('message', event => {
    log('Message received from client:', event.data);
    // 可以在这里处理来自客户端的消息
}); 