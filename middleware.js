// middleware.js
import { NextResponse } from "next/server";

export function middleware(req) {
  const url = req.nextUrl;
  const { pathname, search } = url;

  if (!pathname.startsWith("/blog")) return NextResponse.next();

  const subpath = pathname.replace(/^\/blog/, "") + search;

  // Admin & login -> vaihda aina hostiksi blog.handwrittensignaturegenerator.com (cookie toimii)
  if (
    pathname === "/blog/wp-login.php" ||
    pathname.startsWith("/blog/wp-admin") ||
    pathname.startsWith("/blog/wp-login") ||
    pathname.startsWith("/blog/wp-signup") ||
    pathname.startsWith("/blog/wp-activate")
  ) {
    return NextResponse.redirect(
      "https://blog.handwrittensignaturegenerator.com" + subpath
    );
  }

  // Kaikki muu blogisisältö -> reverse proxy
  return NextResponse.rewrite(
    "https://blog.handwrittensignaturegenerator.com" + subpath
  );
}

export const config = { matcher: ["/blog/:path*"] };
