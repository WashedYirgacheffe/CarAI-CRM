/** IntersectionObserver 的最后一条记录：元素此刻是否在屏幕上 */
export const onScreenNow = (entries: readonly { isIntersecting: boolean }[]) => entries.at(-1)?.isIntersecting;
