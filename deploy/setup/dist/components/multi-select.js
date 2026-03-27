import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Box, Text, useInput } from "ink";
export function MultiSelect({ items, onSubmit, initialSelected = [] }) {
    const [cursor, setCursor] = useState(0);
    const [selected, setSelected] = useState(new Set(initialSelected));
    useInput((input, key) => {
        if (key.upArrow) {
            setCursor((c) => Math.max(0, c - 1));
        }
        else if (key.downArrow) {
            setCursor((c) => Math.min(items.length - 1, c + 1));
        }
        else if (input === " ") {
            setSelected((s) => {
                const next = new Set(s);
                const val = items[cursor].value;
                if (next.has(val))
                    next.delete(val);
                else
                    next.add(val);
                return next;
            });
        }
        else if (key.return) {
            onSubmit([...selected]);
        }
    });
    return (_jsxs(Box, { flexDirection: "column", children: [items.map((item, i) => (_jsxs(Box, { children: [_jsx(Text, { color: i === cursor ? "white" : undefined, bold: i === cursor, children: i === cursor ? "> " : "  " }), _jsx(Text, { children: selected.has(item.value) ? "[x]" : "[ ]" }), _jsxs(Text, { children: [" ", item.label] })] }, item.value))), _jsx(Box, { marginTop: 1, children: _jsx(Text, { dimColor: true, children: "SPACE to toggle, ENTER to confirm" }) })] }));
}
