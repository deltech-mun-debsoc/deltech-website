"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useEditor, EditorContent } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import { Placeholder } from "@tiptap/extension-placeholder"
import Image from "@tiptap/extension-image"
import Link from "@tiptap/extension-link"
import Typography from "@tiptap/extension-typography"
import CharacterCount from "@tiptap/extension-character-count"
import { toast } from "sonner"
import { ImageIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { t } from "@/content/strings"
import { EditorHeader } from "./editor-header"
import { BubbleToolbar } from "./bubble-menu"
import { FloatingInsert } from "./floating-insert"
import { saveDraft, submitPost } from "../actions"
import { uploadToS3 } from "@/lib/media/upload-client"

interface PostProps {
  id:          string
  title:       string
  subtitle:    string | null
  contentJson: Record<string, unknown> | null
  tags:        string[]
  coverImage:  string | null
  status:      string
}

type SaveStatus = "saved" | "saving" | "dirty"

export function WriteEditor({ post }: { post: PostProps }) {
  const router = useRouter()

  const [title,      setTitle]      = useState(post.title)
  const [subtitle,   setSubtitle]   = useState(post.subtitle ?? "")
  const [tags,       setTags]       = useState(post.tags.join(", "))
  const [coverImage, setCoverImage] = useState(post.coverImage ?? "")
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved")
  const [uploading,  setUploading]  = useState(false)

  const saveTimer    = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const imageFileRef = useRef<HTMLInputElement>(null)
  const coverFileRef = useRef<HTMLInputElement>(null)

  // Track latest mutable values for the debounced save closure
  const stateRef = useRef({ title, subtitle, tags, coverImage })
  useEffect(() => { stateRef.current = { title, subtitle, tags, coverImage } }, [title, subtitle, tags, coverImage])

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Tell your story…", emptyEditorClass: "is-editor-empty" }),
      Image.configure({ allowBase64: false, inline: false }),
      Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
      Typography,
      CharacterCount,
    ],
    content: post.contentJson ?? { type: "doc", content: [{ type: "paragraph" }] },
    onUpdate: () => setSaveStatus("dirty"),
    editorProps: {
      attributes: { spellcheck: "true" },
    },
  })

  const doSave = useCallback(async () => {
    if (!editor) return
    setSaveStatus("saving")
    const { title: t, subtitle: s, tags: tg, coverImage: ci } = stateRef.current
    const words   = (editor.storage.characterCount as { words: () => number }).words()
    const readMin = Math.max(1, Math.round(words / 220))

    const result = await saveDraft(post.id, {
      title:       t.trim() || "Untitled",
      subtitle:    s.trim(),
      contentJson: editor.getJSON() as Record<string, unknown>,
      tags:        tg.split(",").map((x) => x.trim()).filter(Boolean),
      coverImage:  ci || undefined,
      readMin,
    })

    if (result.success) setSaveStatus("saved")
    else { setSaveStatus("dirty"); toast.error(result.error ?? "Auto-save failed.") }
  }, [editor, post.id])

  // Debounce save on any dirty change
  useEffect(() => {
    if (saveStatus !== "dirty") return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(doSave, 1500)
    return () => clearTimeout(saveTimer.current)
  }, [saveStatus, doSave])

  const handleMarkDirty = () => setSaveStatus("dirty")

  const handleSubmit = async () => {
    await doSave()
    const result = await submitPost(post.id)
    if (result.success) {
      toast.success("Submitted for review!")
      router.push("/write")
    } else {
      toast.error(result.error ?? "Submission failed.")
    }
  }

  // Both handlers now go through the S3 pipeline: the file is PUT straight to the
  // bucket with a presigned URL, so it never travels through a server action body.
  const handleImageUpload = async (file: File) => {
    setUploading(true)
    const result = await uploadToS3(file, "POST_IMAGE", { ownerType: "Post", ownerId: post.id })
    setUploading(false)
    if (result.url) {
      editor?.chain().focus().setImage({ src: result.url }).run()
    } else {
      toast.error(result.error ?? t("blog.imageUploadFailed"))
    }
  }

  const handleCoverUpload = async (file: File) => {
    setUploading(true)
    const result = await uploadToS3(file, "POST_COVER", { ownerType: "Post", ownerId: post.id })
    setUploading(false)
    if (result.url) {
      setCoverImage(result.url)
      setSaveStatus("dirty")
    } else {
      toast.error(result.error ?? t("blog.coverUploadFailed"))
    }
  }

  const words   = editor ? (editor.storage.characterCount as { words: () => number }).words() : 0
  const readMin = Math.max(1, Math.round(words / 220))

  const canSubmit = post.status === "DRAFT" || post.status === "CHANGES_REQUESTED"

  // Auto-grow textareas
  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Hidden file inputs, pixel-invisible triggers for the upload UX */}
      <input
        ref={imageFileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleImageUpload(f)
          e.target.value = ""
        }}
      />
      <input
        ref={coverFileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleCoverUpload(f)
          e.target.value = ""
        }}
      />

      <EditorHeader
        postId={post.id}
        saveStatus={saveStatus}
        readMin={readMin}
        words={words}
        canSubmit={canSubmit}
        onSave={doSave}
        onSubmit={handleSubmit}
      />

      {uploading && (
        <div className="fixed inset-x-0 top-14 z-30 h-0.5 bg-teal-100">
          <div className="h-full w-1/2 animate-pulse bg-teal-500" />
        </div>
      )}

      <main className="mx-auto max-w-[680px] px-6 pb-32 pt-12">
        {/* Cover image */}
        {coverImage ? (
          <div
            className="group relative mb-10 cursor-pointer overflow-hidden rounded-xl"
            onClick={() => coverFileRef.current?.click()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverImage}
              alt="Cover"
              className="max-h-[420px] w-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <span className="text-sm font-medium text-white">Change cover</span>
            </div>
          </div>
        ) : (
          <button
            onClick={() => coverFileRef.current?.click()}
            className="mb-8 flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-gray-500"
          >
            <ImageIcon className="size-4" />
            Add cover image
          </button>
        )}

        {/* Title */}
        <textarea
          value={title}
          rows={1}
          placeholder="Title"
          className="w-full resize-none overflow-hidden border-0 bg-transparent font-serif text-[2.25rem] font-bold leading-tight text-gray-900 placeholder:text-gray-200 focus:outline-none"
          onChange={(e) => { setTitle(e.target.value); handleMarkDirty() }}
          onInput={(e) => autoGrow(e.currentTarget)}
        />

        {/* Subtitle */}
        <textarea
          value={subtitle}
          rows={1}
          placeholder="Add a subtitle…"
          className="mt-2 w-full resize-none overflow-hidden border-0 bg-transparent font-serif text-xl leading-relaxed text-gray-400 placeholder:text-gray-200 focus:outline-none"
          onChange={(e) => { setSubtitle(e.target.value); handleMarkDirty() }}
          onInput={(e) => autoGrow(e.currentTarget)}
        />

        <div className="my-10 border-t border-gray-100" />

        {/* Tiptap body */}
        <div className={cn("write-canvas relative", !editor && "min-h-[400px]")}>
          {editor && <BubbleToolbar editor={editor} />}
          {editor && (
            <FloatingInsert
              editor={editor}
              onImageInsert={() => imageFileRef.current?.click()}
            />
          )}
          <EditorContent editor={editor} />
        </div>

        {/* Tags */}
        <div className="mt-16 border-t border-gray-100 pt-6">
          <input
            value={tags}
            onChange={(e) => { setTags(e.target.value); handleMarkDirty() }}
            placeholder="Tags (comma-separated)…"
            className="w-full border-0 bg-transparent text-sm text-gray-400 placeholder:text-gray-300 focus:outline-none"
          />
        </div>
      </main>
    </div>
  )
}
