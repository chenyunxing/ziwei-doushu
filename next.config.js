/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['lunar-javascript'],
  allowedDevOrigins: ['192.168.110.15'],
  agentRules: false,
  outputFileTracingExcludes: {
    '*': ['./data/**'],
  },
};

module.exports = nextConfig;
