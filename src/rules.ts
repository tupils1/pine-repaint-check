export type Severity = 'error' | 'warning' | 'info';

export interface RuleMeta {
  id: string;
  name: string;
  severity: Severity;
  summary: string;
  docs: string;
}

const DOCS = 'https://www.tradingview.com/pine-script-docs/concepts/repainting/';

export const RULES: Record<string, RuleMeta> = {
  PRC001: {
    id: 'PRC001', name: 'security-lookahead-future-leak', severity: 'error',
    summary: 'request.security() with lookahead=barmerge.lookahead_on and an expression not offset by [1] leaks future data into historical bars. A value built only from prior-bar references (including arithmetic or a ternary of those) is not reported. A wrapper-function parameter is a warning, and is not reported when every same-file call site passes a [1] (or other history) offset.',
    docs: DOCS + '#future-leak-with-requestsecurity',
  },
  PRC002: {
    id: 'PRC002', name: 'security-htf-unconfirmed', severity: 'warning',
    summary: 'request.security() on another timeframe without the [1] + lookahead_on pattern returns unconfirmed values on realtime bars and repaints after reload.',
    docs: DOCS + '#repainting-requestsecurity-calls',
  },
  PRC003: {
    id: 'PRC003', name: 'calc-on-every-tick', severity: 'warning',
    summary: 'Strategy uses calc_on_every_tick = true: realtime executions differ from historical ones, invalidating the backtest.',
    docs: DOCS + '#strategies',
  },
  PRC004: {
    id: 'PRC004', name: 'varip', severity: 'warning',
    summary: 'varip keeps state across realtime updates that cannot be reproduced on historical bars.',
    docs: DOCS + '#varip',
  },
  PRC005: {
    id: 'PRC005', name: 'timenow', severity: 'warning',
    summary: 'timenow returns the current wall-clock time, so historical and realtime results necessarily differ.',
    docs: DOCS + '#timenow',
  },
  PRC006: {
    id: 'PRC006', name: 'barstate-realtime-dependent', severity: 'info',
    summary: 'barstate.isnew / isrealtime / islast / ishistory / islastconfirmedhistory behave differently on historical and realtime bars. barstate.islast findings are info, so they are hidden when min-severity is warning. The other barstate builtins stay at this rule\'s severity (info). barstate.islast is not reported when it only gates last-bar drawing (table/label/line/box) or a runtime notice.',
    docs: DOCS + '#bar-state-built-ins',
  },
  PRC007: {
    id: 'PRC007', name: 'alert-unconfirmed', severity: 'warning',
    summary: 'alert()/alertcondition() is not gated by barstate.isconfirmed (or alert.freq_once_per_bar_close / a [1] offset), so it can fire on an intrabar signal that later disappears.',
    docs: DOCS + '#fluid-data-values',
  },
  PRC008: {
    id: 'PRC008', name: 'plot-in-the-past', severity: 'info',
    summary: 'Plots/drawings are placed on past bars (negative offset or bar_index[n]/bar_index - n), which shows signals earlier than they were actually known.',
    docs: DOCS + '#plotting-in-the-past',
  },
};

export const SEVERITY_RANK: Record<Severity, number> = { info: 1, warning: 2, error: 3 };
