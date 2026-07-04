// 后台数据更新 Worker
let refreshTimer = null;
let currentStockCode = null;

// 监听主线程消息
self.addEventListener('message', async (event) => {
    const { type, code, interval } = event.data;

    switch (type) {
        case 'startRefresh':
            currentStockCode = code;
            startRefresh(interval);
            break;
        case 'stopRefresh':
            stopRefresh();
            break;
        case 'updateInterval':
            stopRefresh();
            startRefresh(interval);
            break;
        case 'updateCode':
            currentStockCode = code;
            break;
    }
});

// 开始定时刷新
function startRefresh(interval) {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    refreshTimer = setInterval(async () => {
        if (!currentStockCode) return;

        try {
            // 通知主线程需要更新数据
            self.postMessage({
                type: 'refreshData',
                code: currentStockCode
            });
        } catch (error) {
            self.postMessage({
                type: 'error',
                message: error.message
            });
        }
    }, interval * 1000);
}

// 停止定时刷新
function stopRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}