if (!process.env.NEXT_PUBLIC_BASE_URL) {
  throw new Error("NEXT_PUBLIC_BASE_URL is not set");
}

export const baseURL = process.env.NEXT_PUBLIC_BASE_URL
