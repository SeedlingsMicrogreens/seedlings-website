import ProductDetailPage from "@/components/ProductDetailPage";

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ProductDetailPage slug={slug} />;
}
