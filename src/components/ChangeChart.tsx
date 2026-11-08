import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

export interface ChangeDatum {
  name: string;
  value: number;
  color: string;
}

export default function ChangeChart({ data }: { data: ChangeDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 0, bottom: 4 }} barCategoryGap={16}>
        <CartesianGrid stroke="#202937" horizontal={false} />
        <XAxis type="number" hide allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={75} tick={{ fill: "#a2adbc", fontSize: 12 }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: "#1a222e" }} contentStyle={{ background: "#151c26", border: "1px solid #2a3442", borderRadius: 9, color: "#eff3f8" }} labelStyle={{ color: "#eff3f8" }} />
        <Bar dataKey="value" radius={[0, 5, 5, 0]} barSize={18}>
          {data.map((item) => <Cell key={item.name} fill={item.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
