import Head from 'next/head';

export default function MyPage() {
  return (
    <>
      <Head>
        <title>My Custom Title</title>
        <link rel="icon" href="/my-icon.png" />
      </Head>
      <main>
        <h1>Hello World</h1>
      </main>
    </>
  );
}