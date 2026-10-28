// Consuming Vite apps resolve asset imports to URLs; this package typechecks without vite/client.
declare module "*.svg" {
	const url: string
	export default url
}
