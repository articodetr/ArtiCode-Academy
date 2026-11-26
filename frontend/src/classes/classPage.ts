// CH-0374: the address of one class's own page.
export const CLASSES_PAGE_PATH = '/classes'

export const classPagePath = (classId: string) => `${CLASSES_PAGE_PATH}/${encodeURIComponent(classId)}`
