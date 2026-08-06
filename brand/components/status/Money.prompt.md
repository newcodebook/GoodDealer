Every price/valuation in the UI goes through Money — gold tabular mono, 2 decimals, em-dash for null.

```jsx
<Money amount={12800}/>
<Money amount={12800} showCurrency currency="USD"/>
<Money amount={-320} tone="danger" sign/>
```
