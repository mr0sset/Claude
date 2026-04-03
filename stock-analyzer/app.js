// ===== Configuration =====
const BASE_URL = 'https://financialmodelingprep.com/api/v3';
let API_KEY = localStorage.getItem('fmp_api_key') || '';
let priceChart = null;

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
    const keyInput = document.getElementById('apiKey');
    if (API_KEY) {
        keyInput.value = API_KEY;
        keyInput.placeholder = 'Key saved';
    }

    document.getElementById('searchInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') searchCompany();
    });

    // Debounced live search
    let debounceTimer;
    document.getElementById('searchInput').addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const query = e.target.value.trim();
        if (query.length < 2) {
            hideSearchResults();
            return;
        }
        debounceTimer = setTimeout(() => liveSearch(query), 300);
    });

    // Close search results on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-section')) {
            hideSearchResults();
        }
    });
});

// ===== API Key =====
function saveApiKey() {
    API_KEY = document.getElementById('apiKey').value.trim();
    if (API_KEY) {
        localStorage.setItem('fmp_api_key', API_KEY);
        document.getElementById('saveKeyBtn').textContent = 'Saved!';
        setTimeout(() => {
            document.getElementById('saveKeyBtn').textContent = 'Save';
        }, 2000);
    }
}

// ===== API Helper =====
async function fetchAPI(endpoint) {
    if (!API_KEY) {
        alert('Please enter your Financial Modeling Prep API key first.');
        throw new Error('No API key');
    }
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${BASE_URL}${endpoint}${separator}apikey=${API_KEY}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

// ===== Search =====
async function liveSearch(query) {
    try {
        const results = await fetchAPI(`/search?query=${encodeURIComponent(query)}&limit=10`);
        displaySearchResults(results);
    } catch (err) {
        // Silently fail for live search
    }
}

function searchCompany() {
    const query = document.getElementById('searchInput').value.trim();
    if (!query) return;
    liveSearch(query);
}

function displaySearchResults(results) {
    const container = document.getElementById('searchResults');
    if (!results || results.length === 0) {
        container.innerHTML = '<div class="search-result-item"><span class="name">No results found</span></div>';
        container.classList.remove('hidden');
        return;
    }

    // Filter to stocks only
    const stocks = results.filter(r =>
        r.stockExchange && !r.symbol.includes('.')
    ).slice(0, 8);

    if (stocks.length === 0) {
        container.innerHTML = '<div class="search-result-item"><span class="name">No stock results found</span></div>';
        container.classList.remove('hidden');
        return;
    }

    container.innerHTML = stocks.map(r => `
        <div class="search-result-item" onclick="selectCompany('${r.symbol}')">
            <span class="name">${r.name}</span>
            <span>
                <span class="ticker">${r.symbol}</span>
                <span class="exchange">${r.stockExchange || ''}</span>
            </span>
        </div>
    `).join('');
    container.classList.remove('hidden');
}

function hideSearchResults() {
    document.getElementById('searchResults').classList.add('hidden');
}

// ===== Main Analysis =====
async function selectCompany(ticker) {
    hideSearchResults();
    document.getElementById('searchInput').value = ticker;

    // Show loading, hide all sections
    show('loading');
    hide('companyHeader');
    hide('evSection');
    hide('chartSection');
    hide('financialsSection');

    try {
        // Fetch all data in parallel
        const [
            quoteData,
            profileData,
            historicalData,
            incomeData,
            balanceData,
            estimatesData,
            evData
        ] = await Promise.all([
            fetchAPI(`/quote/${ticker}`),
            fetchAPI(`/profile/${ticker}`),
            fetchAPI(`/historical-price-full/${ticker}?timeseries=1825`),
            fetchAPI(`/income-statement/${ticker}?period=annual&limit=5`),
            fetchAPI(`/balance-sheet-statement/${ticker}?period=annual&limit=5`),
            fetchAPI(`/analyst-estimates/${ticker}?limit=3`).catch(() => []),
            fetchAPI(`/enterprise-values/${ticker}?period=annual&limit=1`).catch(() => [])
        ]);

        hide('loading');

        // Render all sections
        renderCompanyHeader(quoteData[0], profileData[0]);
        renderEnterpriseValue(quoteData[0], balanceData[0], profileData[0], evData);
        renderPriceChart(historicalData, ticker);
        renderFinancials(incomeData, balanceData, estimatesData);

    } catch (err) {
        hide('loading');
        console.error('Analysis failed:', err);
        alert(`Failed to load data for ${ticker}. Check your API key and try again.\n\nError: ${err.message}`);
    }
}

// ===== Company Header =====
function renderCompanyHeader(quote, profile) {
    if (!quote) return;

    document.getElementById('companyName').textContent = profile?.companyName || quote.name || '';
    document.getElementById('companyTicker').textContent = quote.symbol || '';
    document.getElementById('companyExchange').textContent = quote.exchange || profile?.exchangeShortName || '';
    document.getElementById('companySector').textContent = profile?.sector || '';

    document.getElementById('currentPrice').textContent = formatCurrency(quote.price);

    const changeEl = document.getElementById('priceChange');
    const pct = quote.changesPercentage;
    changeEl.textContent = `${pct >= 0 ? '+' : ''}${pct?.toFixed(2)}%`;
    changeEl.className = `price-change ${pct >= 0 ? 'positive' : 'negative'}`;

    show('companyHeader');
}

// ===== Enterprise Value =====
function renderEnterpriseValue(quote, balance, profile, evData) {
    if (!quote || !balance) return;

    const marketCap = quote.marketCap || (quote.price * (quote.sharesOutstanding || profile?.sharesOutstanding || 0));
    const totalDebt = (balance.longTermDebt || 0) + (balance.shortTermDebt || 0);
    const cash = balance.cashAndCashEquivalents || balance.cashAndShortTermInvestments || 0;
    const minority = balance.minorityInterest || 0;
    const preferred = balance.preferredStock || 0;
    const ev = marketCap + totalDebt - cash + minority + preferred;

    const balanceDate = balance.date ? ` (${balance.date.substring(0, 10)})` : '';
    const quoteSource = 'Source: Real-time quote';
    const balanceSource = `Source: Balance sheet${balanceDate}`;

    setValue('evMarketCap', formatLargeNumber(marketCap));
    setValue('evMarketCapSource', `${quoteSource} | Price $${quote.price?.toFixed(2)} x ${formatLargeNumber(quote.sharesOutstanding || profile?.sharesOutstanding || 0, true)} shares`);

    setValue('evTotalDebt', formatLargeNumber(totalDebt));
    setValue('evTotalDebtSource', `${balanceSource} | LT: ${formatLargeNumber(balance.longTermDebt || 0)} + ST: ${formatLargeNumber(balance.shortTermDebt || 0)}`);

    setValue('evCash', formatLargeNumber(cash));
    setValue('evCashSource', balanceSource);

    setValue('evMinority', formatLargeNumber(minority));
    setValue('evMinoritySource', balanceSource);

    setValue('evPreferred', formatLargeNumber(preferred));
    setValue('evPreferredSource', balanceSource);

    setValue('evTotal', formatLargeNumber(ev));

    // Compare with FMP's EV if available
    if (evData && evData.length > 0) {
        const fmpEv = evData[0].enterpriseValue;
        setValue('evTotalSource', `Calculated: ${formatLargeNumber(ev)} | FMP reported: ${formatLargeNumber(fmpEv)}`);
    } else {
        setValue('evTotalSource', 'Calculated from components above');
    }

    show('evSection');
}

// ===== Price Chart =====
function renderPriceChart(data, ticker) {
    if (!data || !data.historical || data.historical.length === 0) return;

    const historical = data.historical
        .slice()
        .reverse()
        .map(d => ({
            x: new Date(d.date),
            y: d.close
        }));

    const ctx = document.getElementById('priceChart').getContext('2d');

    if (priceChart) {
        priceChart.destroy();
    }

    // Determine color based on trend
    const firstPrice = historical[0]?.y || 0;
    const lastPrice = historical[historical.length - 1]?.y || 0;
    const isPositive = lastPrice >= firstPrice;
    const lineColor = isPositive ? '#34d399' : '#f87171';
    const bgColor = isPositive ? 'rgba(52, 211, 153, 0.08)' : 'rgba(248, 113, 113, 0.08)';

    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: `${ticker} Close Price`,
                data: historical,
                borderColor: lineColor,
                backgroundColor: bgColor,
                borderWidth: 2,
                fill: true,
                pointRadius: 0,
                pointHitRadius: 10,
                tension: 0.1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: '#1e2235',
                    titleColor: '#e8eaed',
                    bodyColor: '#e8eaed',
                    borderColor: '#2d3148',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        title: (items) => {
                            const date = new Date(items[0].parsed.x);
                            return date.toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric'
                            });
                        },
                        label: (item) => `$${item.parsed.y.toFixed(2)}`
                    }
                }
            },
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'month',
                        displayFormats: { month: 'MMM yyyy' }
                    },
                    grid: {
                        color: 'rgba(45, 49, 72, 0.5)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#6b7280',
                        maxTicksLimit: 12,
                        font: { size: 11 }
                    }
                },
                y: {
                    grid: {
                        color: 'rgba(45, 49, 72, 0.5)',
                        drawBorder: false
                    },
                    ticks: {
                        color: '#6b7280',
                        font: { size: 11 },
                        callback: (value) => '$' + value.toFixed(0)
                    }
                }
            }
        }
    });

    show('chartSection');
}

// ===== Key Financials =====
function renderFinancials(incomeStatements, balanceSheets, estimates) {
    if (!incomeStatements || incomeStatements.length === 0) return;

    // Sort historical data oldest first
    const income = incomeStatements.slice().reverse();
    const balance = balanceSheets.slice().reverse();

    // Build year headers
    const headerRow = document.getElementById('financialsHeader');
    headerRow.innerHTML = '<th>Metric</th>';

    const years = income.map(i => i.calendarYear || i.date?.substring(0, 4) || '');
    years.forEach(y => {
        headerRow.innerHTML += `<th>${y}</th>`;
    });

    // Add forecast years
    const forecastYears = [];
    if (estimates && estimates.length > 0) {
        const sortedEstimates = estimates
            .filter(e => {
                const ey = e.date?.substring(0, 4);
                return ey && !years.includes(ey);
            })
            .sort((a, b) => a.date?.localeCompare(b.date));

        sortedEstimates.forEach(e => {
            const ey = e.date?.substring(0, 4);
            if (ey) {
                forecastYears.push(ey);
                headerRow.innerHTML += `<th class="forecast">${ey}</th>`;
            }
        });
    }

    const tbody = document.getElementById('financialsBody');
    tbody.innerHTML = '';

    // Helper to build rows
    function addSectionHeader(label) {
        const tr = document.createElement('tr');
        tr.className = 'section-header';
        const cols = 1 + years.length + forecastYears.length;
        tr.innerHTML = `<td colspan="${cols}">${label}</td>`;
        tbody.appendChild(tr);
    }

    function addMetricRow(label, values, forecastValues, opts = {}) {
        const tr = document.createElement('tr');
        tr.className = opts.derived ? 'derived-row' : 'metric-row';

        let html = `<td>${label}</td>`;
        values.forEach(v => {
            const cls = opts.colorize ? getColorClass(v) : '';
            html += `<td class="${cls}">${formatTableValue(v, opts)}</td>`;
        });
        forecastValues.forEach(v => {
            const cls = opts.colorize ? getColorClass(v) : '';
            html += `<td class="forecast-cell ${cls}">${formatTableValue(v, opts)}</td>`;
        });

        tr.innerHTML = html;
        tbody.appendChild(tr);
    }

    // Extract historical data
    const revenue = income.map(i => i.revenue);
    const grossProfit = income.map(i => i.grossProfit);
    const ebitda = income.map(i => i.ebitda);
    const ebit = income.map(i => i.operatingIncome);

    // Growth rates
    const revenueGrowth = revenue.map((r, i) => i === 0 ? null : (r - revenue[i - 1]) / Math.abs(revenue[i - 1]));
    const grossMargin = revenue.map((r, i) => r ? grossProfit[i] / r : null);
    const ebitdaMargin = revenue.map((r, i) => r ? ebitda[i] / r : null);
    const ebitMargin = revenue.map((r, i) => r ? ebit[i] / r : null);

    // Capital employed = Total Assets - Current Liabilities
    const capitalEmployed = balance.map(b => {
        const totalAssets = b.totalAssets || 0;
        const currentLiab = b.totalCurrentLiabilities || 0;
        return totalAssets - currentLiab;
    });

    // Forecast data
    const sortedEstimates = (estimates || [])
        .filter(e => {
            const ey = e.date?.substring(0, 4);
            return ey && !years.includes(ey);
        })
        .sort((a, b) => a.date?.localeCompare(b.date));

    const fRevenue = sortedEstimates.map(e => e.estimatedRevenueAvg);
    const fEbitda = sortedEstimates.map(e => e.estimatedEbitdaAvg);
    const fEbit = sortedEstimates.map(e => e.estimatedEbitAvg);
    const fNetIncome = sortedEstimates.map(e => e.estimatedNetIncomeAvg);

    // Forecast growth & margins
    const lastRevenue = revenue[revenue.length - 1];
    const fRevenueGrowth = fRevenue.map((r, i) => {
        const prev = i === 0 ? lastRevenue : fRevenue[i - 1];
        return prev ? (r - prev) / Math.abs(prev) : null;
    });
    const fEbitdaMargin = fRevenue.map((r, i) => r && fEbitda[i] ? fEbitda[i] / r : null);
    const fEbitMargin = fRevenue.map((r, i) => r && fEbit[i] ? fEbit[i] / r : null);

    // Render rows
    addSectionHeader('Revenue');
    addMetricRow('Sales', revenue.map(v => v / 1e6), fRevenue.map(v => v ? v / 1e6 : null), { suffix: 'M' });
    addMetricRow('Growth %', revenueGrowth, fRevenueGrowth, { derived: true, pct: true, colorize: true });

    addSectionHeader('Profitability');
    addMetricRow('Gross Profit', grossProfit.map(v => v / 1e6), [], { suffix: 'M' });
    addMetricRow('Margin %', grossMargin, [], { derived: true, pct: true });
    addMetricRow('EBITDA', ebitda.map(v => v / 1e6), fEbitda.map(v => v ? v / 1e6 : null), { suffix: 'M' });
    addMetricRow('Margin %', ebitdaMargin, fEbitdaMargin, { derived: true, pct: true });
    addMetricRow('EBIT', ebit.map(v => v / 1e6), fEbit.map(v => v ? v / 1e6 : null), { suffix: 'M' });
    addMetricRow('Margin %', ebitMargin, fEbitMargin, { derived: true, pct: true });

    addSectionHeader('Capital');
    addMetricRow('Capital Employed', capitalEmployed.map(v => v / 1e6), [], { suffix: 'M' });

    show('financialsSection');
}

// ===== Formatting Helpers =====
function formatCurrency(value) {
    if (value == null) return '-';
    return '$' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatLargeNumber(value, isCount) {
    if (value == null) return '-';
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';

    if (abs >= 1e12) return sign + '$' + (abs / 1e12).toFixed(2) + 'T';
    if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(1) + 'K';
    return sign + '$' + abs.toFixed(0);
}

function formatTableValue(value, opts = {}) {
    if (value == null || isNaN(value)) return '-';
    if (opts.pct) return (value * 100).toFixed(1) + '%';
    return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function getColorClass(value) {
    if (value == null || isNaN(value)) return '';
    return value >= 0 ? 'positive' : 'negative';
}

// ===== DOM Helpers =====
function show(id) { document.getElementById(id).classList.remove('hidden'); }
function hide(id) { document.getElementById(id).classList.add('hidden'); }
function setValue(id, text) { document.getElementById(id).textContent = text; }
