// Generated from src/shared/ability-priority.ts; sha256 229c6900eb5c721243232f3e0cef8d7f48196e7b0035a766aa55c21135f7b626
export const DEFAULT_PRIORITY_FORMULA = 'winWeight * (ABS(winZ)^2 * SIGN(winZ) + 2 * winZ) + pickWeight * pickZ * pickFrequency';
export const DEFAULT_ABILITY_PRIORITY = {
    mode: 'custom',
    winWeight: -1,
    pickWeight: 10,
    formula: DEFAULT_PRIORITY_FORMULA,
};
export const PRIORITY_VARIABLES = [
    'winWeight',
    'pickWeight',
    'winZ',
    'pickZ',
    'pickFrequency',
    'winrate',
    'avgPick',
    'winMean',
    'winStd',
    'pickMean',
    'pickStd',
];
const FUNCTIONS = {
    ABS: { min: 1, max: 1, run: Math.abs },
    SIGN: { min: 1, max: 1, run: Math.sign },
    SQRT: { min: 1, max: 1, run: Math.sqrt },
    POWER: { min: 2, max: 2, run: Math.pow },
    MIN: { min: 1, max: 16, run: Math.min },
    MAX: { min: 1, max: 16, run: Math.max },
};
/** A bounded recursive-descent parser supporting Excel-style ^ and functions. */
export function compilePriorityFormula(formula) {
    if (typeof formula !== 'string' || !formula.trim() || formula.length > 1000) {
        throw new Error('公式不能为空，且不能超过 1000 个字符。');
    }
    const source = formula.trim().replace(/^=/, '');
    const tokens = source.match(/(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[^\s]/g) ?? [];
    if (tokens.length > 250)
        throw new Error('公式过于复杂，请减少运算项。');
    let cursor = 0;
    let depth = 0;
    const take = () => tokens[cursor++];
    const requireToken = (token) => {
        if (take() !== token)
            throw new Error(`公式缺少 ${token}。`);
    };
    function primary() {
        if (++depth > 32)
            throw new Error('公式嵌套不能超过 32 层。');
        try {
            const token = take();
            if (token === '(') {
                const expr = sum();
                requireToken(')');
                return expr;
            }
            if (token && /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token)) {
                const value = Number(token);
                if (!Number.isFinite(value))
                    throw new Error('公式中的数值必须有限。');
                return () => value;
            }
            if (token && tokens[cursor] === '(') {
                const func = FUNCTIONS[token.toUpperCase()];
                if (!func)
                    throw new Error(`不支持函数 ${token}。`);
                take();
                const args = [];
                if (tokens[cursor] !== ')') {
                    args.push(sum());
                    while (tokens[cursor] === ',') {
                        take();
                        args.push(sum());
                    }
                }
                requireToken(')');
                if (args.length < func.min || args.length > func.max)
                    throw new Error(`${token} 的参数数量不正确。`);
                return (vars) => func.run(...args.map((arg) => arg(vars)));
            }
            if (token && PRIORITY_VARIABLES.includes(token)) {
                return (vars) => vars[token];
            }
            throw new Error(`无法识别 ${token ?? '公式末尾'}。`);
        }
        finally {
            depth--;
        }
    }
    function power() {
        const left = primary();
        if (tokens[cursor] !== '^')
            return left;
        take();
        const right = unary();
        return (vars) => left(vars) ** right(vars);
    }
    function unary() {
        const sign = tokens[cursor];
        if (sign !== '+' && sign !== '-')
            return power();
        take();
        const operand = unary();
        return (vars) => (sign === '-' ? -1 : 1) * operand(vars);
    }
    function product() {
        let expr = unary();
        while (tokens[cursor] === '*' || tokens[cursor] === '/') {
            const op = take();
            const left = expr;
            const right = unary();
            expr = (vars) => (op === '*' ? left(vars) * right(vars) : left(vars) / right(vars));
        }
        return expr;
    }
    function sum() {
        let expr = product();
        while (tokens[cursor] === '+' || tokens[cursor] === '-') {
            const op = take();
            const left = expr;
            const right = product();
            expr = (vars) => (op === '+' ? left(vars) + right(vars) : left(vars) - right(vars));
        }
        return expr;
    }
    const expression = sum();
    if (cursor !== tokens.length)
        throw new Error(`无法识别 ${tokens[cursor]}。`);
    return (vars) => {
        const result = expression(vars);
        if (!Number.isFinite(result))
            throw new Error('公式产生非有限值，请检查除零或函数参数。');
        return result;
    };
}
export function validateAbilityPrioritySettings(value) {
    if (!value || typeof value !== 'object')
        throw new Error('选位规则格式不正确。');
    const config = value;
    if (config.mode !== 'custom' && config.mode !== 'standard')
        throw new Error('选位模式不正确。');
    if (!Number.isFinite(config.winWeight) || !Number.isFinite(config.pickWeight)) {
        throw new Error('胜率系数和选位系数必须是有限数字。');
    }
    compilePriorityFormula(config.formula);
    return {
        mode: config.mode,
        winWeight: config.winWeight,
        pickWeight: config.pickWeight,
        formula: config.formula,
    };
}
export function sampleSummary(values) {
    if (values.length === 0)
        return { mean: 0, std: 0 };
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.length < 2
        ? 0
        : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    const std = Math.sqrt(variance);
    if (!Number.isFinite(mean) || !Number.isFinite(std)) {
        throw new Error('公式数值过大，无法计算全量数据的均值或标准差。');
    }
    return { mean, std };
}
/** Full Windrun population, including hero models. Never pass just the scan pool. */
export function calculateAbilityPriorities(rows, config) {
    const evaluate = compilePriorityFormula(config.formula);
    const valid = rows.filter((row) => row.winrate !== null &&
        Number.isFinite(row.winrate) &&
        row.winrate >= 0 &&
        row.winrate <= 1 &&
        row.pickRate !== null &&
        Number.isFinite(row.pickRate) &&
        row.draftFrequency != null &&
        Number.isFinite(row.draftFrequency) &&
        row.draftFrequency >= 0 &&
        row.draftFrequency <= 1);
    const win = sampleSummary(valid.map((row) => row.winrate));
    const pick = sampleSummary(valid.map((row) => row.pickRate));
    const raw = valid.map((row) => evaluate({
        winWeight: config.winWeight,
        pickWeight: config.pickWeight,
        winZ: win.std > 0 ? (row.winrate - win.mean) / win.std : 0,
        pickZ: pick.std > 0 ? (row.pickRate - pick.mean) / pick.std : 0,
        pickFrequency: row.draftFrequency,
        winrate: row.winrate,
        avgPick: row.pickRate,
        winMean: win.mean,
        winStd: win.std,
        pickMean: pick.mean,
        pickStd: pick.std,
    }));
    const rawStats = sampleSummary(raw);
    const priorities = new Map();
    valid.forEach((row, i) => {
        const priority = rawStats.std > 0
            ? ((raw[i] - rawStats.mean) / rawStats.std) * pick.std + pick.mean
            : pick.mean;
        if (!Number.isFinite(priority))
            throw new Error('公式选位产生非有限值，请调整公式。');
        priorities.set(row.name, priority);
    });
    return { priorities, count: valid.length, win, pick, raw: rawStats };
}
/** Strictly descending bounded conversion for existing score-based UI consumers. */
export function priorityToScore(priority) {
    return priority === null ? 0 : 0.5 - Math.atan((priority - 25.5) / 24.5) / Math.PI;
}
