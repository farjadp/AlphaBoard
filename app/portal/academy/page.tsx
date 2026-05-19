import { prisma } from '@/lib/prisma';
import { auth } from '@/auth';

export default async function AcademyPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const lessons = await prisma.courseLesson.findMany({
    orderBy: { order: 'asc' },
    include: {
      progress: {
        where: { userId: session.user.id }
      }
    }
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Trading Academy</h1>
      
      {lessons.length === 0 ? (
        <div className="bg-gray-800 p-8 rounded-xl text-center border border-gray-700">
          <p className="text-gray-400">No lessons available yet. Check back later!</p>
        </div>
      ) : (
        <div className="space-y-4">
          {lessons.map((lesson: any) => {
            const isCompleted = lesson.progress.length > 0 && lesson.progress[0].completed;
            
            return (
              <div key={lesson.id} className="bg-gray-800 p-6 rounded-xl border border-gray-700 flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-semibold mb-1">{lesson.title}</h3>
                  <p className="text-sm text-gray-400">Lesson {lesson.order}</p>
                </div>
                <div>
                  {isCompleted ? (
                    <span className="text-green-400 bg-green-400/10 px-3 py-1 rounded-full text-sm font-medium">
                      Completed
                    </span>
                  ) : (
                    <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded transition-colors text-sm">
                      Start Lesson
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
