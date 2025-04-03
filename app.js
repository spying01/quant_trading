// 腾讯API前缀
const TENCENT_API_PREFIX = 'https://web.sqt.gtimg.cn/q=';
const MAX_HISTORY_POINTS = 999; // 最大历史数据点数
const ALERT_COOLDOWN = 5000; // 5秒冷却时间

// 全局变量
let chart = null;
let refreshTimer = null;
let currentStockCode = null;
let priceHistory = []; // 存储历史价格数据
let lastAlertTime = 0;
let titleBlinkInterval = null;
let originalTitle = document.title;

// DOM加载完成后初始化
document.addEventListener('DOMContentLoaded', function() {
    initTheme();
    initEventListeners();
    updateHistorySelect();
});

// 初始化主题
function initTheme() {
    if (localStorage.theme === 'dark' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.classList.add('dark');
    } else {
        document.documentElement.classList.remove('dark');
    }
}

// 初始化事件监听
function initEventListeners() {
    // 主题切换
    document.getElementById('themeToggle').addEventListener('click', function() {
        document.documentElement.classList.toggle('dark');
        localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    });

    // 股票代码输入框回车事件
    document.getElementById('stockCode').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchStock();
        }
    });

    // 查询按钮点击事件
    document.getElementById('searchBtn').addEventListener('click', searchStock);

    // 历史记录选择事件
    document.getElementById('historyStocks').addEventListener('change', selectHistoryStock);

    // 删除历史记录按钮事件
    document.getElementById('deleteHistory').addEventListener('click', deleteHistoryStock);

    // 刷新间隔选择事件
    document.getElementById('refreshInterval').addEventListener('change', updateRefreshInterval);

    // 窗口大小改变时调整图表
    window.addEventListener('resize', function() {
        if (chart) {
            chart.resize();
        }
    });

    // 页面关闭时清除定时器
    window.addEventListener('beforeunload', function() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
        }
        if (titleBlinkInterval) {
            clearInterval(titleBlinkInterval);
        }
    });
}

// 获取股票数据
async function fetchStockData(code) {
    if (!code || code.length !== 6) {
        throw new Error('请输入6位股票代码');
    }

    try {
        // 添加股票代码前缀
        const fullCode = code.startsWith('6') ? `sh${code}` : `sz${code}`;
        const response = await fetch(`${TENCENT_API_PREFIX}${fullCode}`);
        
        if (!response.ok) {
            throw new Error('网络请求失败');
        }
        
        const buffer = await response.arrayBuffer();
        // 使用 GBK 解码
        const text = new TextDecoder('gbk').decode(buffer);
        const data = parseTencentData(text, fullCode);
        
        if (!data) {
            throw new Error('数据解析失败');
        }
        
        return data;
    } catch (error) {
        console.error('获取数据失败:', error);
        throw error;
    }
}

// 解析腾讯数据
function parseTencentData(text, code) {
    try {
        // 移除 v_ 前缀，获取实际数据
        const dataStr = text.replace(`v_${code}="`, '').replace('";', '');
        const values = dataStr.split('~');
        
        if (values.length < 40) {
            console.error('数据格式不正确:', values);
            return null;
        }

        const price = parseFloat(values[3]) || 0;
        const lastClose = parseFloat(values[4]) || price;
        const priceChange = ((price - lastClose) / lastClose * 100).toFixed(2);

        return {
            name: values[1] || '未知',
            price: price,
            change: priceChange + '%',
            trend: price > lastClose ? '上升趋势' : '下降趋势',
            support: (price * 0.98).toFixed(2),
            resistance: (price * 1.02).toFixed(2),
            high: parseFloat(values[33]) || price,
            low: parseFloat(values[34]) || price,
            turnover: values[38] || '0',
            lastClose: lastClose
        };
    } catch (error) {
        console.error('解析数据出错:', error);
        return null;
    }
}

// 查询股票
async function searchStock() {
    const code = document.getElementById('stockCode').value.trim();
    if (!code) {
        alert('请输入股票代码');
        return;
    }
    
    try {
        setLoadingState(true);
        currentStockCode = code;
        const stockData = await fetchStockData(code);
        
        // 只在手动输入股票代码时添加到历史记录
        if (document.getElementById('stockCode').value === code) {
            addToHistory(code, stockData.name);
        }
        
        await updateStockData();
    } catch (error) {
        alert('获取数据失败：' + error.message);
    } finally {
        setLoadingState(false);
    }
}

// 设置加载状态
function setLoadingState(isLoading) {
    const searchText = document.getElementById('searchText');
    const searchSpinner = document.getElementById('searchSpinner');
    const searchBtn = document.getElementById('searchBtn');
    
    if (isLoading) {
        searchText.textContent = '查询中...';
        searchSpinner.classList.remove('hidden');
        searchBtn.disabled = true;
    } else {
        searchText.textContent = '查询';
        searchSpinner.classList.add('hidden');
        searchBtn.disabled = false;
    }
}

// 更新股票数据
async function updateStockData() {
    if (!currentStockCode) return;
    
    try {
        const stockData = await fetchStockData(currentStockCode);
        updateStockInfo(stockData);
        updateChart(stockData);
        updateLastUpdateTime();
    } catch (error) {
        alert('获取数据失败：' + error.message);
    }
}

// 更新股票信息显示
function updateStockInfo(data) {
    try {
        if (!data) {
            throw new Error('数据无效');
        }

        document.getElementById('code').textContent = document.getElementById('stockCode').value;
        document.getElementById('name').textContent = data.name;
        document.getElementById('price').textContent = data.price.toFixed(2);
        document.getElementById('change').textContent = data.change;
        document.getElementById('trend').textContent = data.trend;
        document.getElementById('support').textContent = data.support;
        document.getElementById('resistance').textContent = data.resistance;
        
        updateSignalDisplay(data);
    } catch (error) {
        console.error('更新股票信息出错:', error);
        alert('更新股票信息失败：' + error.message);
    }
}

// 更新图表
function updateChart(data) {
    if (!chart) {
        chart = echarts.init(document.getElementById('chart'));
    }
    
    // 更新价格历史数据
    const now = new Date();
    const timeStr = now.toLocaleTimeString();
    priceHistory.push({
        time: timeStr,
        price: data.price
    });
    
    // 限制历史数据点数
    if (priceHistory.length > MAX_HISTORY_POINTS) {
        priceHistory = priceHistory.slice(-MAX_HISTORY_POINTS);
    }
    
    const option = {
        title: {
            text: `${data.name} (${document.getElementById('stockCode').value}) 价格走势`,
            left: 'center'
        },
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                let result = params[0].axisValue + '<br/>';
                params.forEach(param => {
                    result += `${param.seriesName}: ${param.value}<br/>`;
                });
                return result;
            }
        },
        legend: {
            data: ['实时价格'],
            bottom: 0
        },
        grid: {
            left: '3%',
            right: '4%',
            bottom: '10%',
            containLabel: true
        },
        xAxis: {
            type: 'category',
            data: priceHistory.map(item => item.time),
            axisLabel: {
                rotate: 45
            }
        },
        yAxis: {
            type: 'value',
            scale: true,
            splitLine: {
                show: true,
                lineStyle: {
                    type: 'dashed'
                }
            }
        },
        series: [
            {
                name: '实时价格',
                type: 'line',
                data: priceHistory.map(item => item.price),
                smooth: true,
                symbol: 'none',
                lineStyle: {
                    width: 2
                },
                areaStyle: {
                    opacity: 0.1
                }
            }
        ]
    };
    
    chart.setOption(option);
}

// 更新最后更新时间
function updateLastUpdateTime() {
    const now = new Date();
    document.getElementById('lastUpdate').textContent = 
        `最后更新时间：${now.toLocaleTimeString()}`;
}

// 更新刷新间隔
function updateRefreshInterval() {
    const interval = parseInt(document.getElementById('refreshInterval').value);
    
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }
    
    if (interval > 0 && currentStockCode) {
        refreshTimer = setInterval(updateStockData, interval * 1000);
    }
}

// 生成交易信号
function generateTradeSignal(data) {
    const signals = [];
    const priceChange = parseFloat(data.change);
    const currentPrice = data.price;
    
    // 涨跌幅策略
    if (priceChange > 2) {
        signals.push({
            type: 'sell',
            strength: 'strong',
            reason: '日内涨幅过大(>' + priceChange.toFixed(2) + '%)',
            details: [
                '当前涨幅：' + priceChange.toFixed(2) + '%',
                '超过2%的涨幅阈值',
                '可能存在短期回调风险'
            ]
        });
    } else if (priceChange < -2) {
        signals.push({
            type: 'buy',
            strength: 'strong',
            reason: '日内跌幅过大(<' + priceChange.toFixed(2) + '%)',
            details: [
                '当前跌幅：' + priceChange.toFixed(2) + '%',
                '超过2%的跌幅阈值',
                '可能存在超跌反弹机会'
            ]
        });
    }
    
    // 价格位置策略
    if (currentPrice > data.resistance) {
        signals.push({
            type: 'sell',
            strength: 'medium',
            reason: '接近压力位',
            details: [
                '当前价格：' + currentPrice.toFixed(2),
                '压力位：' + data.resistance,
                '价格突破压力位，可能面临回调'
            ]
        });
    } else if (currentPrice < data.support) {
        signals.push({
            type: 'buy',
            strength: 'medium',
            reason: '接近支撑位',
            details: [
                '当前价格：' + currentPrice.toFixed(2),
                '支撑位：' + data.support,
                '价格接近支撑位，可能存在反弹机会'
            ]
        });
    }
    
    // 趋势策略
    if (data.trend === '上升趋势') {
        signals.push({
            type: 'buy',
            strength: 'weak',
            reason: '价格处于上升趋势',
            details: [
                '当前趋势：上升趋势',
                '均线呈多头排列',
                '建议关注回调买入机会'
            ]
        });
    } else {
        signals.push({
            type: 'sell',
            strength: 'weak',
            reason: '价格处于下降趋势',
            details: [
                '当前趋势：下降趋势',
                '均线呈空头排列',
                '建议谨慎操作，等待企稳'
            ]
        });
    }
    
    return signals;
}

// 更新信号显示
function updateSignalDisplay(data) {
    const signals = generateTradeSignal(data);
    const signalDiv = document.getElementById('signal');
    signalDiv.className = 'signal mt-4 p-4 rounded-lg text-center font-medium';
    
    if (signals.length === 0) {
        signalDiv.textContent = '暂无明确信号 - 建议观望';
        signalDiv.classList.add('hold');
        return;
    }
    
    // 找出最强信号
    const strongestSignal = signals.reduce((prev, curr) => {
        const strengthMap = { strong: 3, medium: 2, weak: 1 };
        return strengthMap[curr.strength] > strengthMap[prev.strength] ? curr : prev;
    });
    
    // 创建信号显示内容
    let signalHTML = `
        <div class="mb-2">
            <span class="text-lg font-bold">${strongestSignal.type === 'buy' ? '买入' : '卖出'}信号</span>
            <span class="text-xs ml-2 px-2 py-1 rounded ${
                strongestSignal.strength === 'strong' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' : 
                strongestSignal.strength === 'medium' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' : 
                'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
            }">
                ${strongestSignal.strength === 'strong' ? '强' : strongestSignal.strength === 'medium' ? '中' : '弱'}
            </span>
        </div>
        <div class="text-sm mb-2">原因：${strongestSignal.reason}</div>
        <div class="text-xs text-left mt-2">
            <div class="font-semibold mb-1">详细分析：</div>
            <ul class="list-disc list-inside space-y-1">
                ${strongestSignal.details.map(detail => `<li>${detail}</li>`).join('')}
            </ul>
        </div>
    `;
    
    signalDiv.innerHTML = signalHTML;
    signalDiv.classList.add(strongestSignal.type === 'buy' ? 'buy' : 'sell');

    // 检查是否需要提醒
    const now = Date.now();
    if (now - lastAlertTime > ALERT_COOLDOWN && strongestSignal.strength !== 'weak') {
        const stockName = document.getElementById('name').textContent;
        const signalType = strongestSignal.type === 'buy' ? '买入' : '卖出';
        showAlert(`${stockName} ${signalType}信号 (${strongestSignal.strength === 'strong' ? '强' : '中'})`);
        lastAlertTime = now;
    }
}

// 显示提醒
function showAlert(message) {
    // 开始标题闪烁
    let isOriginal = true;
    titleBlinkInterval = setInterval(() => {
        document.title = isOriginal ? `⚠️ ${message}` : originalTitle;
        isOriginal = !isOriginal;
    }, 1000);
    
    // 3秒后停止闪烁
    setTimeout(() => {
        clearInterval(titleBlinkInterval);
        document.title = originalTitle;
    }, 3000);
}

// 历史记录相关功能
function addToHistory(code, name) {
    // 验证输入数据
    if (!code || !name || name === '未知') {
        console.warn('无效的股票数据:', { code, name });
        return;
    }

    let history = JSON.parse(localStorage.getItem('stockHistory') || '[]');
    // 清理无效数据
    history = history.filter(item => item && item.code && item.name && item.name !== '未知');
    // 移除已存在的相同代码
    history = history.filter(item => item.code !== code);
    // 添加到开头
    history.unshift({code: code, name: name});
    // 限制历史记录数量为10个
    if (history.length > 10) {
        history = history.slice(0, 10);
    }
    localStorage.setItem('stockHistory', JSON.stringify(history));
    updateHistorySelect();
}

function updateHistorySelect() {
    const history = JSON.parse(localStorage.getItem('stockHistory') || '[]');
    const select = document.getElementById('historyStocks');
    const deleteBtn = document.getElementById('deleteHistory');
    
    // 保存当前选中的值
    const currentValue = select.value;
    
    // 清理无效数据
    const validHistory = history.filter(item => item && item.code && item.name && item.name !== '未知');
    
    // 清除现有选项
    select.innerHTML = '<option value="">历史记录</option>';
    
    // 添加历史记录
    validHistory.forEach(item => {
        const option = document.createElement('option');
        option.value = item.code;
        option.textContent = `${item.code} - ${item.name}`;
        select.appendChild(option);
    });
    
    // 恢复之前选中的值
    if (currentValue) {
        select.value = currentValue;
    }
    
    // 更新删除按钮显示状态
    deleteBtn.style.display = select.value ? 'block' : 'none';
    
    // 如果清理后的数据与原始数据不同，更新存储
    if (validHistory.length !== history.length) {
        localStorage.setItem('stockHistory', JSON.stringify(validHistory));
    }
}

function selectHistoryStock() {
    const select = document.getElementById('historyStocks');
    const deleteBtn = document.getElementById('deleteHistory');
    const code = select.value;
    if (code) {
        document.getElementById('stockCode').value = code;
        deleteBtn.style.display = 'block';
        searchStock();
    } else {
        deleteBtn.style.display = 'none';
    }
}

function deleteHistoryStock() {
    const select = document.getElementById('historyStocks');
    const code = select.value;
    if (!code) return;

    if (confirm('确定要删除这条历史记录吗？')) {
        let history = JSON.parse(localStorage.getItem('stockHistory') || '[]');
        // 清理无效数据
        history = history.filter(item => item && item.code && item.name);
        history = history.filter(item => item.code !== code);
        localStorage.setItem('stockHistory', JSON.stringify(history));
        updateHistorySelect();
        document.getElementById('stockCode').value = '';
    }
}