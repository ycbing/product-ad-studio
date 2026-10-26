import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "拾序 Ad Studio · 商品广告工作室",
  description: "用真实商品素材，制作可编辑的竖屏广告。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
